# BzCat - Upstash Redis 설정 가이드

Vercel Postgres 대신 **Upstash Redis**를 사용하는 방법입니다.

> Vercel KV는 2024년 12월 종료되었으며, Upstash Redis로 마이그레이션해야 합니다.

---

## 1단계: Upstash Redis 추가

### Vercel Marketplace에서 설치

1. **Vercel Dashboard** 접속
2. 프로젝트 선택 → **Storage** 탭
3. **Create Database** 클릭
4. **Redis** 카테고리에서 **Upstash Redis** 선택
5. **Continue** 클릭

### Upstash 계정 옵션

- **Create New Upstash Account**: Vercel이 Upstash 계정을 생성하고 관리
- **Link Existing Upstash Account**: 기존 Upstash 계정 연결 (팀, 감사 로그 등 사용 시)

### 데이터베이스 생성

1. **Database Name**: `bzcat-redis` (원하는 이름)
2. **Region**: 가장 가까운 지역 선택 (예: `ap-northeast-1` - 도쿄)
3. **Create** 클릭

---

## 2단계: 환경 변수 자동 주입 확인

Upstash 연동 후 다음 환경 변수가 자동으로 프로젝트에 추가됩니다:

| 변수명 | 설명 |
|--------|------|
| `UPSTASH_REDIS_REST_URL` | Redis REST API URL |
| `UPSTASH_REDIS_REST_TOKEN` | Redis REST API 토큰 |

확인 경로: **Settings** → **Environment Variables**

---

## 3단계: GitHub에 코드 반영 후 재배포

1. 수정된 코드를 GitHub에 push (또는 웹에서 업로드)
2. Vercel이 자동으로 재배포
3. **Deployments**에서 완료 여부 확인

---

## 4단계: Admin 사용자 초기화 (선택)

Redis는 스키마가 없어 테이블 생성이 필요 없습니다.  
Admin 이메일(`bzcatmanager@gmail.com`)은 코드에서 자동으로 처리됩니다.

별도 초기 데이터는 불필요합니다.

---

## Redis vs Postgres 비교

| 항목 | Postgres | Redis (Upstash) |
|------|----------|-----------------|
| 데이터 구조 | 관계형 (테이블, JOIN) | Key-Value, Hash, Sorted Set |
| 쿼리 | SQL | Redis 명령어 |
| 적합 용도 | 복잡한 관계, 대용량 조회 | 세션, 캐시, 실시간 데이터 |
| Vercel | Postgres deprecated → Neon | Upstash Redis (현재 지원) |

---

## 문제 해결

### 환경 변수가 보이지 않는 경우

1. Storage → Upstash Redis → **Connect Project** 확인
2. 프로젝트가 연결되어 있는지 확인
3. 연결 후 **Redeploy** 실행

### Redis 연결 오류

1. `UPSTASH_REDIS_REST_URL`, `UPSTASH_REDIS_REST_TOKEN` 확인
2. Vercel Logs에서 오류 메시지 확인:
   - **Deployments** → 최신 배포 → **Functions** 탭

### 로컬 개발

로컬에서 테스트하려면 Upstash Console에서 Redis URL과 Token을 복사해 `.env.local`에 추가:

```env
UPSTASH_REDIS_REST_URL=https://xxx.upstash.io
UPSTASH_REDIS_REST_TOKEN=AXxxxxxx
```

---

## 주문 데이터 전부 지우기 (테스트 초기화)

**방법 1 – 스크립트 (권장)**  
프로젝트 루트에서 실행 (`.env.local`이 있으면 자동으로 사용):

```bash
node scripts/clear-orders.js
```

`order:*`, `orders:by_user:*`, `orders:count:*` 키가 전부 삭제됩니다.

**방법 2 – Upstash 콘솔에서 직접**  
1. [Upstash Console](https://console.upstash.com/) 로그인 후 해당 Redis DB 선택  
2. **Data Browser**에서 키 목록 확인  
3. `order:*`, `orders:by_user:*`, `orders:count:*` 패턴에 해당하는 키를 골라 삭제  
   (또는 CLI에서 `SCAN`/`KEYS`로 찾은 뒤 `DEL`로 삭제)
