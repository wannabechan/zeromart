# BzCat 배포 가이드

## 1단계: Upstash Redis 추가

1. Vercel Dashboard 접속
2. 프로젝트 선택 → **Storage** 탭
3. **Create Database** 클릭
4. **Redis** 카테고리에서 **Upstash Redis** 선택
5. **Continue** → Database name 입력 (예: `bzcat-redis`) → Region 선택 → **Create**
6. 환경 변수(`UPSTASH_REDIS_REST_URL`, `UPSTASH_REDIS_REST_TOKEN`)가 자동으로 주입됨

> ⚠️ Vercel KV는 2024년 12월 종료되었습니다. Upstash Redis를 사용합니다.
> 상세 가이드: [REDIS_SETUP.md](./REDIS_SETUP.md)

## 2단계: Vercel Blob 추가 (이미지 업로드용)

1. Vercel Dashboard → 프로젝트 → **Storage** 탭
2. **Create Database** → **Blob** 선택 → **Continue**
3. Blob store 이름 입력 (예: `bzcat-images`) → **Create**
4. 환경 변수 `BLOB_READ_WRITE_TOKEN`이 자동으로 주입됨
5. 로컬 개발 시: `vercel env pull`로 환경 변수 가져오기

## 3단계: Resend 설정

1. https://resend.com 가입
2. API Key 생성 (API Keys 메뉴)
3. 도메인 인증 (실서비스용, Domains 메뉴)
4. 상세 가이드: [RESEND_SETUP.md](./RESEND_SETUP.md)

## 4단계: 환경 변수 설정

Vercel Dashboard → 프로젝트 → Settings → Environment Variables

다음 변수를 추가:

```
JWT_SECRET=<강력한-랜덤-문자열-64자-이상>
RESEND_API_KEY=re_xxxxxxxxxxxxxxxxxxxxx
RESEND_FROM_EMAIL=noreply@yourdomain.com  (도메인 인증 후, 선택)
TOSS_SECRET_KEY=test_sk_xxxx  (토스페이먼츠 결제용, 시크릿 키는 서버 전용)
CRON_SECRET=<랜덤문자열>  (선택, 자동 취소 크론 보안용. 설정 시 /api/cron/auto-cancel-orders 호출 시 Authorization: Bearer <CRON_SECRET> 필요)
```

JWT_SECRET 생성 예시:
```bash
node -e "console.log(require('crypto').randomBytes(64).toString('hex'))"
```

## 5단계: GitHub에 Push

```bash
git add .
git commit -m "Add backend API and database"
git push origin main
```

## 6단계: 자동 배포 확인

Vercel이 자동으로 배포를 시작합니다:
- Vercel Dashboard → Deployments에서 진행 상황 확인
- 배포 완료 후 URL 확인

## 7단계: 테스트

1. 배포된 URL 접속
2. 이메일로 로그인 시도
3. 인증 코드 수신 확인 (실제 이메일)
4. 주문 테스트

## 문제 해결

### 이메일이 발송되지 않는 경우

1. Resend API 키 확인
2. Vercel Logs에서 오류 확인:
   ```
   Vercel Dashboard → Deployments → [최신 배포] → Functions 탭
   ```
3. 개발 모드에서는 `devCode`로 테스트 가능 (이메일 발송 없이)

### Redis 연결 오류

1. Upstash Redis가 프로젝트에 연결되어 있는지 확인
2. 환경 변수가 자동으로 주입되었는지 확인:
   ```
   Settings → Environment Variables → UPSTASH_REDIS_REST_URL, UPSTASH_REDIS_REST_TOKEN
   ```

### 이미지 업로드 오류

1. Vercel Blob store가 프로젝트에 연결되어 있는지 확인
2. `BLOB_READ_WRITE_TOKEN` 환경 변수 확인
3. 허용 형식: JPEG, PNG, WebP, GIF (최대 4MB)

### JWT 오류

1. `JWT_SECRET`이 환경 변수에 설정되어 있는지 확인
2. 모든 환경(Production, Preview, Development)에 설정되어 있는지 확인

## 프로덕션 체크리스트

- [ ] Upstash Redis 생성 및 프로젝트 연결
- [ ] Resend API 키 발급 및 설정
- [ ] JWT_SECRET 생성 및 설정
- [ ] 이메일 발송 주소를 실제 도메인으로 변경
- [ ] GitHub 연결 및 자동 배포 설정
- [ ] 로그인 테스트 (실제 이메일 수신 확인)
- [ ] 주문 생성 테스트
- [ ] 에러 로그 확인

## 다음 단계

- [ ] 관리자 페이지 구축 (주문 목록 조회)
- [ ] 주문 상태 관리 (확정, 완료, 취소)
- [ ] 이메일 알림 (주문 확정, 배송 안내)
- [ ] Manager 레벨 이메일 목록 관리
