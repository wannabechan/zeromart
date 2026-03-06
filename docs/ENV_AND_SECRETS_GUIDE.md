# 5단계: 환경 변수·비밀값 분리 (Zero Mart 전용)

원본 bzcat과 **같은 키/비밀을 공유하지 않도록** Zero Mart 전용 환경만 사용합니다.

---

## 1. 로컬 환경 파일 새로 만들기

`.env`, `.env.local`은 git에 포함되지 않으므로 **복사하지 말고** Zero Mart용으로 **새로 작성**합니다.

```bash
cd /Users/wannabechan/vibecoding/zeromart
touch .env.local
```

아래 변수들을 **Zero Mart 전용 값**으로 채웁니다. (bzcat의 `.env.local` 값을 그대로 붙여넣지 마세요.)

---

## 2. 필요한 환경 변수 목록

### 필수 (로컬 + Vercel)

| 변수 | 설명 | Zero Mart에서 할 일 |
|------|------|---------------------|
| `KV_REST_API_URL` | Upstash Redis REST URL | **Upstash에서 새 Redis DB 생성** 후 해당 URL 사용 (Vercel Storage 연결 시 자동 주입 가능) |
| `KV_REST_API_TOKEN` | Upstash Redis REST Token | 위와 동일 DB의 토큰 |
| `JWT_SECRET` | 로그인 세션 서명용 비밀키 | **새 랜덤 문자열 생성** (예: `openssl rand -base64 32`) |

### 이메일 (Resend)

| 변수 | 설명 | Zero Mart에서 할 일 |
|------|------|---------------------|
| `RESEND_API_KEY` | Resend API 키 | **Resend에서 새 API 키 발급** (Zero Mart용) |
| `RESEND_FROM_EMAIL` | 발신 이메일 주소 | Zero Mart용 도메인/이메일 인증 후 사용 (예: `noreply@yourdomain.com`) |
| `RESEND_FROM_NAME` | 발신자 이름 (선택) | 예: `Zero Mart` |

### 관리자

| 변수 | 설명 | Zero Mart에서 할 일 |
|------|------|---------------------|
| `EMAIL_ADMIN` | 관리자 이메일 (권한 판별·문의용) | `zeromartmanager@gmail.com` 등 Zero Mart 관리자 메일 |

### 배포·크론 (Vercel 배포 시)

| 변수 | 설명 | Zero Mart에서 할 일 |
|------|------|---------------------|
| `APP_ORIGIN` | 프론트 도메인 (선택) | 배포된 Zero Mart URL (예: `https://zeromart.vercel.app`) |
| `CRON_SECRET` | 크론 엔드포인트 보안 | **새 랜덤 문자열 생성** (Vercel Cron이 호출 시 쿼리/헤더에 포함해 검증) |

---

## 3. 서비스별로 “새 프로젝트” 만들기

- **Vercel**  
  - bzcat 프로젝트가 아닌 **새 Vercel 프로젝트**를 만들고, Zero Mart용 GitHub 저장소만 연결합니다.  
  - 환경 변수는 이 문서의 **Zero Mart 전용 값**만 넣습니다.

- **Upstash Redis**  
  - bzcat이 쓰는 DB와 **별도 Redis 데이터베이스**를 하나 새로 만든 뒤, 그 DB의 `KV_REST_API_URL`, `KV_REST_API_TOKEN`만 Zero Mart에 등록합니다.

- **Resend**  
  - **새 API 키**를 발급해 Zero Mart 프로젝트에서만 사용합니다.  
  - 발신 도메인/이메일도 Zero Mart용으로 인증합니다.

---

## 4. `key/` 폴더 (키 파일)

- `key/` 폴더는 `.gitignore`에 포함되어 있어, 원본 bzcat의 키 파일은 복사되지 않았을 수 있습니다.
- **원본 bzcat의 `key/` 내용을 그대로 가져와 쓰지 마세요.**
- 인증서·비밀키 등이 필요하면 **Zero Mart 전용으로 새로 생성**한 뒤, 그 파일만 `key/`에 두고 코드에서 참조하세요.

---

## 5. 로컬 `.env.local` 예시 (최소)

```env
# Redis (Upstash Zero Mart 전용 DB)
KV_REST_API_URL=https://xxxx.upstash.io
KV_REST_API_TOKEN=AXxx...

# JWT (새로 생성한 값)
JWT_SECRET=your-zeromart-jwt-secret-min-32-chars

# Resend (Zero Mart 전용 키·발신)
RESEND_API_KEY=re_xxxx
RESEND_FROM_EMAIL=noreply@yourdomain.com
RESEND_FROM_NAME=Zero Mart

# 관리자
EMAIL_ADMIN=zeromartmanager@gmail.com
```

이렇게 하면 bzcat과 Zero Mart의 **DB·메일·인증·결제**가 서로 완전히 분리됩니다.
