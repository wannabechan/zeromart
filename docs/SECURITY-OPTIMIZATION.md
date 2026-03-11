# 보안 리스크 점검 및 코드 최적화 보고서

## 적용한 보안 개선

### 1. 이미지 업로드 확장자 제어 (`api/admin/upload-image.js`)
- **문제**: 클라이언트가 보낸 `originalFilename`의 확장자를 그대로 사용하면, 악의적인 확장자(예: `.php`, `.phtml`)가 blob 경로에 포함될 수 있음.
- **조치**: 업로드 허용 MIME 타입에 따라 서버에서 확장자를 고정 매핑(`MIMETYPE_EXT`)하여 사용. 클라이언트 파일명은 저장 경로에 사용하지 않음.

### 2. PDF 다운로드 파일명 헤더 이스케이프 (`api/orders/pdf.js`)
- **문제**: `Content-Disposition`의 `filename`에 쿼리 파라미터 `store`(storeSlug)를 그대로 넣으면, 따옴표·백슬래시·개행 등으로 헤더 조작 또는 응답 분할 가능성 있음.
- **조치**: `storeSlug`는 `[a-z0-9_-]`만 허용하도록 정규화하고, 최종 `filename`에서 `"`, `\`, `\r`, `\n` 제거 후 헤더에 설정.

---

## 점검 결과 요약 (추가 권장 사항)

### 인증·인가
- **JWT**: `api/_utils.js`에서 `JWT_SECRET` 길이 16자 이상 검사 적용됨. 만료 3일 설정.
- **API**: admin/manager/orders 등 보호 구간은 `Authorization: Bearer` + `verifyToken` 후 `user.level` 또는 `user.email`로 권한 구분. 일관되게 적용됨.
- **CRON**: `api/cron/auto-cancel-orders.js`에서 `CRON_SECRET`으로 Bearer 검증.

### XSS 대응
- **프론트**: `app.js`, `admin/admin.js`, `store-orders/store-orders.js`에서 사용자/서버 데이터를 HTML로 넣을 때 `escapeHtml()` 사용이 전반적으로 적용됨. `innerHTML`에 넣는 문자열은 이스케이프 후 사용 권장을 계속 유지.

### CORS·헤더
- `api/_utils.js`의 `setCorsHeaders`에서 `X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY` 설정됨.
- production에서는 `APP_ORIGIN`만 허용하도록 설정됨.

### 기타 권장
- **이메일 인증 코드**: `POST /api/auth/send-code`에 rate limit(예: IP/이메일당 분당 횟수 제한)을 두면 악용(스팸/피싱) 완화에 도움됨.
- **환경 변수**: `JWT_SECRET`, `EMAIL_ADMIN`, `CRON_SECRET`, `RESEND_API_KEY`, `KV_REST_API_TOKEN` 등은 배포 환경에서 반드시 설정하고, 코드/저장소에 노출되지 않도록 유지.

---

## 코드 최적화 요약

### 현재 상태
- **중복 유틸**: `escapeHtml`이 `app.js`, `admin/admin.js`, `store-orders/store-orders.js`에 각각 정의됨. 페이지별로 스크립트가 나뉘어 있어 공유 모듈로 묶지 않아도 동작에는 문제 없음. 필요 시 공통 `assets/js/utils.js` 등으로 분리 가능.
- **API**: `parseInt(..., 10)` 및 `Math.min/Math.max`로 `limit`/`offset` 범위 제한 적용됨(예: admin/orders, manager/orders).
- **이미지 업로드**: `path.extname` 제거로 불필요한 `path` 의존성 제거됨.

### 권장 (선택)
- 정산·통계 등 반복되는 날짜/숫자 포맷은 작은 헬퍼로 묶어 가독성·일관성 확보.
- 프론트에서 동일 스크립트를 여러 페이지에서 쓸 경우, 공통 함수를 한 파일로 모아 캐시 효율을 높일 수 있음.

---

*마지막 점검: 2025년 기준 코드베이스 기준.*
