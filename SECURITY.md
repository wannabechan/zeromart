# Zero Mart 보안 점검 요약

## 적용된 보안 조치

- **응답 헤더**: API 응답에 `X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY` 적용 (`api/_utils.js` setCorsHeaders).
- **CORS**: production에서는 `APP_ORIGIN`만 허용, 개발 시에만 `*` 허용.
- **인증**: 관리자/매장 담당자 API는 Bearer JWT 검증. `JWT_SECRET`은 환경 변수로 관리.
- **XSS 대응**: Admin·매장·앱에서 사용자/주문 데이터를 HTML에 넣을 때 `escapeHtml()` 사용.
- **입력 검증**: 주문 ID, 날짜, slug 등은 trim·타입 검사 후 사용. 결제 확인은 토스 API 연동으로 검증.

## 참고 사항

- **PDF/거부 링크**: `api/orders/pdf`, `api/orders/reject` 등은 쿼리 파라미터로 `token`을 받을 수 있음. URL이 로그·Referer에 남을 수 있으므로, 가능하면 POST + Body 또는 단기 토큰 사용을 권장.
- **결제 성공 리다이렉트**: `paymentKey` 등은 쿼리로 전달되며, 서버에서는 로그에 paymentKey를 남기지 않도록 되어 있음. 클라이언트 리다이렉트 URL에는 잠시 노출되므로 단기 유효 토큰 사용이 이상적.
- **Cron**: `CRON_SECRET`으로 호출자 검증. Vercel Cron은 내부 호출이지만, 시크릿 미설정 시 401 반환.
- **민감 정보**: `RESEND_API_KEY`, `KV_REST_API_TOKEN`, `TOSS_SECRET_KEY` 등은 환경 변수에만 두고 코드/클라이언트에 노출되지 않음.

## 정기 점검 권장

- [ ] 환경 변수(시크릿) 로테이션
- [ ] 의존성 `npm audit` 실행
- [ ] 관리자/매장 로그인 계정 관리 정책 확인
