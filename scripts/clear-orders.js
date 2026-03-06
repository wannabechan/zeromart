/**
 * Redis에 저장된 주문 관련 키 전부 삭제 (테스트 초기화용)
 * 사용법:
 *   로컬: 프로젝트 루트에서
 *     node scripts/clear-orders.js
 *   환경 변수: UPSTASH_REDIS_REST_URL, UPSTASH_REDIS_REST_TOKEN 필요
 *     (.env.local 있으면 아래에서 자동 로드 시도)
 */

const path = require('path');
const fs = require('fs');

// .env.local 로드 (있으면)
const envPath = path.join(__dirname, '..', '.env.local');
if (fs.existsSync(envPath)) {
  const content = fs.readFileSync(envPath, 'utf8');
  content.split('\n').forEach((line) => {
    const m = line.match(/^\s*([^#=]+)=(.*)$/);
    if (m) process.env[m[1].trim()] = m[2].trim().replace(/^["']|["']$/g, '');
  });
}

const { getRedis } = require('../api/_redis');

async function clearOrders() {
  const redis = getRedis();

  const patterns = ['order:*', 'orders:by_user:*', 'orders:count:*'];
  let totalDeleted = 0;

  const BATCH = 100;
  for (const pattern of patterns) {
    const keys = await redis.keys(pattern);
    if (keys && keys.length > 0) {
      for (let i = 0; i < keys.length; i += BATCH) {
        const chunk = keys.slice(i, i + BATCH);
        await redis.del(...chunk);
      }
      totalDeleted += keys.length;
      console.log(`삭제: ${pattern} → ${keys.length}개`);
    }
  }

  console.log('주문 관련 키 삭제 완료. (총 ' + totalDeleted + '개)');
}

clearOrders().catch((err) => {
  console.error('오류:', err.message);
  process.exit(1);
});
