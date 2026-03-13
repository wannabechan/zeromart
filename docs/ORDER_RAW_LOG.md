# 주문 원시 로그 생성·관리 및 보안 저장 가이드

## 1. 개요

- **목적**: 신규/결제/취소 등 모든 주문 이벤트를 한 곳에 기록해, 추후 주문 데이터 삭제·수정 시 분쟁 대비 및 감사용으로 사용.
- **형식**: CSV (한 줄 = 한 이벤트).
- **민감정보**: 저장 제외 또는 마스킹 후 기록.

---

## 2. 로그 생성·관리

### 2.1 코드 위치

- **모듈**: `api/_orderRawLog.js`
  - 마스킹: `maskEmail`, `maskContact`, `maskDepositor`, `maskAddress`
  - 이벤트 기록: `appendOrderRawLog(order, { eventType, statusAfter, actor, note, cancelReason? })`
- **Cron(일별 flush)**: `api/cron/export-order-raw-log.js`

### 2.2 이벤트 기록 흐름

1. **실시간**: 주문 생성/수락/결제링크/결제완료/발송완료/취소 등 발생 시 `appendOrderRawLog()` 호출.
2. **버퍼**: Redis 키 `order_raw_log:YYYY-MM-DD` 리스트에 CSV 한 줄씩 `RPUSH`.
3. **일별 내보내기**: Cron이 전날 날짜 키를 읽어 CSV 전체 생성 후 Blob에 업로드하고, 해당 Redis 키 삭제.

### 2.3 주문 API에서 호출 예시

```js
const { appendOrderRawLog } = require('./_orderRawLog');

// 주문 생성 직후
await appendOrderRawLog(order, {
  eventType: 'order_created',
  statusAfter: 'submitted',
  actor: 'user',
  note: '주문 접수',
});

// 결제 완료 시
await appendOrderRawLog(order, {
  eventType: 'payment_completed',
  statusAfter: 'payment_completed',
  actor: 'payment',
  note: '결제 완료',
});

// 취소 시
await appendOrderRawLog(order, {
  eventType: 'order_cancelled',
  statusAfter: 'cancelled',
  actor: 'system',
  note: '자동 취소',
  cancelReason: '결제기한만료',
});
```

---

## 3. 마스킹 규칙

| 항목 | 규칙 | 예시 |
|------|------|------|
| 이메일 | 앞 2자+@도메인 | `ab***@example.com` |
| 연락처 | 뒤 4자리만 | `5678` |
| 수령인/주문자명 | 성(1글자)+이름 마지막 1자 | `김*수`, `남**민` |
| 주소 | 상세주소만 제외 | 도로명/동까지만 |
| 저장 제외 | 카드번호·CVC·비밀번호·토큰·API키·주민번호 등 | 로그에 넣지 않음 |

---

## 4. 보안을 고려한 저장 방법

### 4.1 저장 위치 (Git 제외)

- **로그 파일(CSV 데이터)은 Git 저장소에 올리지 않는다.**
- `.gitignore`에 다음을 추가해 두었음:
  - `logs/`, `data/`, `zeromartrawlog*.csv` → 로컬/빌드 산출물이 실수로 커밋되지 않도록.

### 4.2 현재 구현 (Vercel Blob 비공개 + 어드민 다운로드)

- **저장**: Cron `export-order-raw-log`가 일별 CSV를 Blob에 **비공개**(`access: 'private'`)로 업로드.
  - Blob 스토어를 **Private**으로 쓰려면 Vercel 대시보드에서 해당 프로젝트 Storage → Blob 스토어 생성 시 **Access: Private**으로 설정해야 함.
- **다운로드**: **어드민만** 사용 가능한 API로 제공.
  - `GET /api/admin/download-order-raw-log?date=YYYY-MM-DD`
  - 요청 시 `Authorization: Bearer <어드민 JWT>` 필요. 인증 통과 시 해당 일자 CSV를 스트리밍으로 내려줌.

### 4.3 접근 통제

- 로그 파일 다운로드/열람은 **어드민만** 가능 (`download-order-raw-log`에서 `user.level === 'admin'` 검사).
- Blob은 `access: 'private'`으로 올리므로 URL만으로는 접근 불가. 반드시 위 API를 통해 어드민 인증 후 다운로드.
- 로그 보관 기간을 정책으로 두고, 기간 지난 파일은 삭제 또는 아카이브 스토리지로 이관.

### 4.4 Cron 보안

- `export-order-raw-log` Cron은 **CRON_SECRET**으로 보호됨.
- Vercel Cron 설정 시 Authorization 헤더에 `Bearer <CRON_SECRET>` 포함해 호출.

### 4.5 정리

- **생성/관리**: `_orderRawLog.js`로 이벤트별 append, Redis 일별 버퍼, Cron으로 일별 CSV 생성·Blob 비공개 업로드.
- **저장**: Git에는 로그 파일을 넣지 않음. Blob은 비공개 저장, 다운로드는 `GET /api/admin/download-order-raw-log?date=YYYY-MM-DD` (어드민 인증 필수)로만 제공.
