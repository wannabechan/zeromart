# NHN Cloud 알림톡 설정 (신규 주문 → 매장 담당자)

## 1. NHN Cloud 콘솔에서 할 일

### 1) 앱키 / 시크릿키 / 발신 키 확인
- **Notification > KakaoTalk Bizmessage** 서비스에서 **앱키**, **시크릿 키**를 확인합니다.
- **발신 프로필**에서 사용할 **발신 키(40자)** 를 확인합니다.

### 2) 신규 주문 알림 템플릿 등록
- **알림톡 > 템플릿** 메뉴에서 **템플릿 등록**을 합니다.
- **템플릿 코드**: 영문/숫자로 원하는 코드를 지정합니다 (예: `NEW_ORDER`). 이 코드를 환경 변수에 넣습니다.
- **메시지 내용**에 아래 치환자를 넣을 수 있습니다.

| 치환자 | 설명 | 예시 |
|--------|------|------|
| `#{orderId}` | 주문 번호 | abc-123 |
| `#{storeName}` | 매장(카테고리)명 | 도시락 |
| `#{depositor}` | 입금자명 | 홍길동 |
| `#{totalAmount}` | 총 금액(포맷됨) | 50,000원 |
| `#{deliveryDate}` | 배송 희망일 | 2026-02-15 |

**예시 템플릿 문구:**
```
[BzCat 신규 주문]
매장: #{storeName}
주문번호: #{orderId}
입금자: #{depositor}
금액: #{totalAmount}
배송희망일: #{deliveryDate}
```
- 템플릿을 **검수 요청** 후 **승인**받아야 발송됩니다.

---

## 2. 환경 변수 설정 (Vercel / .env.local)

다음 값을 설정합니다.

| 변수명 | 필수 | 설명 |
|--------|------|------|
| `NHN_ALIMTALK_APPKEY` | O | NHN Cloud 앱키 |
| `NHN_ALIMTALK_SECRET_KEY` | O | NHN Cloud 시크릿 키 |
| `NHN_ALIMTALK_SENDER_KEY` | O | 발신 프로필 발신 키(40자) |
| `NHN_ALIMTALK_TEMPLATE_CODE_STORE_NEW_ORDER` | O | 위에서 등록한 **신규 주문**(매장 담당자용) 템플릿 코드 |

- **Vercel**: 프로젝트 > Settings > Environment Variables 에 추가.
- **로컬**: 프로젝트 루트 `.env.local` 에 추가.

---

## 3. 동작 조건

- **매장·메뉴 관리(admin)** 에서 해당 매장의 **담당자연락처**에 **010으로 시작하는 11자리 휴대폰 번호**가 저장되어 있어야 합니다.
- 위 환경 변수 4개가 모두 설정되어 있어야 발송을 시도합니다.
- 주문 생성 시 해당 주문의 매장(카테고리)에 연결된 담당자 연락처로만 발송됩니다.

---

## 4. 추가 알림톡 (주문 취소 / 결제 완료 / 배송 준비)

다음 3종도 NHN 콘솔에 템플릿을 등록한 뒤, 아래 환경 변수에 **템플릿 코드**를 넣습니다.

| 환경 변수 | 발송 시점 | 치환자 |
|-----------|-----------|--------|
| `NHN_ALIMTALK_TEMPLATE_CODE_STORE_CANCEL_ORDER` | 주문 취소 시 (고객/관리자/매장거부/결제기한만료 등) | `#{orderId}`, `#{storeName}`, `#{depositor}`, `#{cancelReason}` |
| `NHN_ALIMTALK_TEMPLATE_CODE_STORE_PAY_ORDER` | 결제 링크로 결제 완료 시 | `#{orderId}`, `#{storeName}`, `#{depositor}`, `#{totalAmount}`, `#{deliveryDate}` |
| `NHN_ALIMTALK_TEMPLATE_CODE_STORE_PREPARE_ORDER` | 배송일 **하루 전 오전 10시(KST)** 크론 발송 | `#{orderId}`, `#{storeName}`, `#{deliveryDate}`, `#{deliveryTime}`, `#{depositor}`, `#{totalAmount}` |

- **배송 준비**는 Vercel Cron `0 1 * * *`(매일 01:00 UTC = 10:00 KST)에 `/api/cron/alimtalk-delivery-reminder`가 호출되며, 배송 희망일이 **내일**인 주문(결제완료/배송중/배송완료)에 대해 매장 담당자에게만 발송됩니다. `CRON_SECRET`이 설정되어 있어야 합니다.
