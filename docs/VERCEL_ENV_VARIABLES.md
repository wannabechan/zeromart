# Vercel 환경 변수 설정 목록 (Zero Mart)

GitHub 연결 후 Vercel Dashboard → 프로젝트 → **Settings → Environment Variables**에서 아래 변수들을 등록하세요.

**주의:** 실제 비밀값(API 키, 시크릿)은 이 문서에 적지 말고, Vercel 화면에서만 입력하세요. 아래 "설정할 값"은 **어디서/무엇을 넣으면 되는지** 안내입니다.

---

## 필수 (없으면 로그인·DB·이메일 동작 안 함)

| 환경 변수 | 설정할 값 | 비고 |
|-----------|-----------|------|
| `KV_REST_API_URL` | Upstash Redis REST URL | Vercel Dashboard → Storage → Redis 연결 시 **자동 주입**되거나, [Upstash](https://console.upstash.com/)에서 DB 생성 후 **REST URL** 복사 |
| `KV_REST_API_TOKEN` | Upstash Redis REST Token | 위와 동일 DB의 **REST Token** |
| `JWT_SECRET` | 16자 이상 랜덤 문자열 | 로그인 세션 서명용. 터미널에서 `openssl rand -base64 32` 실행 후 나온 값을 그대로 넣으면 됨 |
| `RESEND_API_KEY` | Resend API 키 | [Resend](https://resend.com) → API Keys에서 **Create API Key** 후 발급된 키 (예: `re_xxxx...`) |
| `RESEND_FROM_EMAIL` | 발신 이메일 주소 | Resend에서 **도메인 인증**한 주소 (예: `noreply@yourdomain.com`). 인증 전에는 Resend 제공 테스트 주소 사용 가능 |

---

## 권장 (관리자·도메인·크론)

| 환경 변수 | 설정할 값 | 비고 |
|-----------|-----------|------|
| `EMAIL_ADMIN` | `zeromartmanager@gmail.com` | 관리자 권한 판별 + 문의용 표시. 이 이메일로 로그인한 사용자가 admin |
| `APP_ORIGIN` | 배포된 URL (예: `https://zeromart.vercel.app`) | CORS·리다이렉트 기준. 비워두면 요청의 Host로 동작하므로 보통 생략 가능 |
| `CRON_SECRET` | 랜덤 문자열 (예: 32자) | 자동 취소 크론(`/api/cron/auto-cancel-orders`) 호출 시 **Authorization: Bearer &lt;이 값&gt;** 헤더로 인증. `openssl rand -base64 32`로 생성 권장 |

---

## 선택 (기능별)

| 환경 변수 | 설정할 값 | 비고 |
|-----------|-----------|------|
| `RESEND_FROM_NAME` | `Zero Mart` | 이메일 발신자 이름. 비우면 코드 기본값 "Zero Mart" 사용 |
| `TOSS_SECRET_KEY` | Toss Payments **시크릿 키** | 결제 사용 시: [Toss 개발자센터](https://developers.tosspayments.com/) → 내 애플리케이션 → 시크릿 키. **테스트**용이면 `TOSS_SECRET_KEY_TEST`에 테스트 시크릿 키 넣고, 라이브용이면 `TOSS_SECRET_KEY`에 라이브 시크릿 키 |
| `TOSS_SECRET_KEY_TEST` | Toss Payments **테스트 시크릿 키** | 위와 동일 위치에서 테스트 키 (결제 테스트 시 사용) |

매장(스토어)별로 다른 결제 키를 쓰는 경우, 어드민에서 해당 매장에 `payment.apiKeyEnvVar`를 `PAYKEY_매장ID` 형태로 두고, Vercel에는 `PAYKEY_매장ID` 이름으로 해당 매장의 Toss 시크릿 키를 등록하면 됩니다.

---

## Vercel에서 설정하지 않는 것

- **NODE_ENV** – Vercel이 배포 시 자동으로 `production` 설정
- **NHN_ALIMTALK_*** – 메시징 제거됨. 설정하지 않음

---

## 한 줄 요약

**최소로 꼭 넣을 것:**  
`KV_REST_API_URL`, `KV_REST_API_TOKEN`, `JWT_SECRET`, `RESEND_API_KEY`, `RESEND_FROM_EMAIL`

**운영 권장 추가:**  
`EMAIL_ADMIN`, `CRON_SECRET`

**결제 쓸 때 추가:**  
`TOSS_SECRET_KEY` 또는 `TOSS_SECRET_KEY_TEST`
