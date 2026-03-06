# SendGrid 이메일 발송 설정 가이드

BzCat 로그인 인증 코드는 **SendGrid (Twilio)**를 통해 발송됩니다.

---

## 1단계: SendGrid 가입

1. https://sendgrid.com 접속
2. **Start for Free** 클릭 후 가입
3. 이메일 인증 완료

---

## 2단계: 발신자(Sender) 인증

SendGrid에서 **인증된 발신 이메일**이 있어야 발송할 수 있습니다.

### 방법 A: 단일 이메일 인증 (가장 빠름)

1. SendGrid Dashboard → **Settings** → **Sender Authentication**
2. **Verify a Single Sender** 클릭
3. 폼 작성:
   - **From Name**: `BzCat`
   - **From Email**: 사용할 이메일 (예: `noreply@yourdomain.com` 또는 본인 Gmail)
   - 나머지 정보 입력
4. **Create** 클릭
5. SendGrid에서 발송한 인증 메일의 **링크 클릭**으로 인증 완료

### 방법 B: 도메인 인증 (실서비스 권장)

1. SendGrid Dashboard → **Settings** → **Sender Authentication**
2. **Authenticate Your Domain** 클릭
3. 도메인 입력 (예: `bzcat.com`)
4. 안내에 따라 **DNS 레코드** 추가 (도메인 관리 화면)
5. 인증 완료 후 해당 도메인의 아무 이메일 주소로 발송 가능

---

## 3단계: API Key 생성

1. SendGrid Dashboard → **Settings** → **API Keys**
2. **Create API Key** 클릭
3. **API Key Name**: `BzCat Production` (원하는 이름)
4. **API Key Permissions**: **Restricted Access** 선택
5. **Mail Send** → **Full Access** 체크
6. **Create & View** 클릭
7. **API Key 복사** (다시 볼 수 없으므로 안전하게 보관)

---

## 4단계: Vercel 환경 변수 설정

1. Vercel Dashboard → bzcat 프로젝트
2. **Settings** → **Environment Variables**
3. 다음 변수 추가:

| Name | Value | 비고 |
|------|-------|------|
| `SENDGRID_API_KEY` | `SG.xxxxx...` (복사한 API Key) | 필수 |
| `SENDGRID_FROM_EMAIL` | 인증한 발신 이메일 (예: `noreply@bzcat.com`) | 선택 (기본값: noreply@bzcat.com) |
| `SENDGRID_FROM_NAME` | 발신자 이름 (예: `BzCat`) | 선택 (기본값: BzCat) |

4. **Environments**: Production, Preview, Development 모두 체크
5. **Save** 클릭

---

## 5단계: 재배포

환경 변수 변경 후 **재배포**가 필요합니다.

1. Vercel Dashboard → **Deployments**
2. 최신 배포 → **⋮** → **Redeploy**

---

## 6단계: 테스트

1. 배포된 BzCat URL 접속
2. 로그인 화면에서 이메일 입력
3. **로그인 코드 생성** 클릭
4. 해당 이메일 수신함 확인 (스팸함도 확인)

---

## 문제 해결

### 이메일이 오지 않는 경우

1. **SendGrid Dashboard** → **Activity** → 최근 발송 내역 확인
2. **SENDGRID_FROM_EMAIL**이 SendGrid에서 인증된 주소인지 확인
3. **SENDGRID_API_KEY**가 올바르게 설정되었는지 확인
4. 스팸함 확인

### 403 Forbidden 오류

- 발신 이메일이 SendGrid에서 **인증되지 않음** → Sender Authentication 완료
- API Key 권한 부족 → Mail Send 권한 확인

### 401 Unauthorized 오류

- **SENDGRID_API_KEY**가 잘못됨 또는 만료됨 → 새 API Key 생성 후 재설정

---

## 무료 플랜 제한

- **일 100통** (월 약 3,000통) 무료
- 인증 코드 발송용으로 충분한 수준
