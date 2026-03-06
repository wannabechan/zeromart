# Resend 이메일 발송 설정 가이드

BzCat 로그인 인증 코드는 **Resend**를 통해 발송됩니다.

---

## 1단계: Resend 가입

1. https://resend.com 접속
2. **Sign Up** 클릭 후 가입
3. 이메일 인증 완료

---

## 2단계: API Key 생성

1. Resend Dashboard → **API Keys**
2. **Create API Key** 클릭
3. **Name**: `BzCat Production` (원하는 이름)
4. **Permission**: Sending access
5. **Add** 클릭
6. **API Key 복사** (다시 볼 수 없으므로 안전하게 보관)

---

## 3단계: 발신 도메인 설정

### 방법 A: 테스트용 (가장 빠름)

- Resend 기본 도메인 `resend.dev` 사용
- **추가 설정 없이** 바로 발송 가능
- 발신 주소: `onboarding@resend.dev` (Resend 가입 시 제공)
- **제한**: 수신자가 `onboarding@resend.dev`로만 발송 가능 (본인 이메일로 테스트)

> ⚠️ `onboarding@resend.dev`는 **자신의 Resend 계정 이메일**로만 발송됩니다.  
> 다른 사용자 이메일로 발송하려면 도메인 인증이 필요합니다.

### 방법 B: 도메인 인증 (실서비스)

1. Resend Dashboard → **Domains** → **Add Domain**
2. 도메인 입력 (예: `bzcat.com`)
3. 안내에 따라 **DNS 레코드** 추가 (도메인 관리 화면)
4. 인증 완료 후 `noreply@bzcat.com` 등으로 발송 가능

---

## 4단계: Vercel 환경 변수 설정

1. Vercel Dashboard → bzcat 프로젝트
2. **Settings** → **Environment Variables**
3. 다음 변수 추가:

| Name | Value | 비고 |
|------|-------|------|
| `RESEND_API_KEY` | `re_xxxxx...` (복사한 API Key) | **필수** |
| `RESEND_FROM_EMAIL` | `noreply@yourdomain.com` (인증한 도메인) | 선택, 도메인 인증 후 |
| `RESEND_FROM_NAME` | `BzCat` | 선택 (기본값: BzCat) |

**테스트 시**: `RESEND_FROM_EMAIL`을 설정하지 않으면 `onboarding@resend.dev` 사용  
**실서비스**: 도메인 인증 후 `RESEND_FROM_EMAIL`에 인증한 이메일 설정

4. **Environments**: Production, Preview, Development 모두 체크
5. **Save** 클릭

---

## 5단계: 재배포

환경 변수 변경 후 **재배포**가 필요합니다.

1. Vercel Dashboard → **Deployments**
2. 최신 배포 → **⋮** → **Redeploy**

---

## 6단계: 테스트

### 테스트용 (onboarding@resend.dev)

- Resend 가입한 이메일 주소로 로그인 코드 요청
- 해당 이메일 수신함 확인

### 실서비스 (도메인 인증 후)

- 인증한 도메인의 아무 이메일로 발송 가능

---

## 무료 플랜

- **월 3,000통** 무료 (일 100통)
- 기간 제한 없음

---

## 문제 해결

### 이메일이 오지 않는 경우

1. **Resend Dashboard** → **Emails** → **Logs** 확인
2. `RESEND_API_KEY`가 올바르게 설정되었는지 확인
3. 도메인 미인증 시: Resend 가입 이메일로만 테스트 가능

### 403 / 도메인 오류

- 도메인 인증 완료 여부 확인
- `RESEND_FROM_EMAIL`이 인증된 도메인 주소인지 확인
