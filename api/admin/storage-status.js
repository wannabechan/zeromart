/**
 * GET /api/admin/storage-status
 * 어드민: 연결된 저장소별 요약.
 *
 * Redis: Upstash REST — INFO memory 의 used_memory(바이트)와
 *       STORAGE_REDIS_PLAN_MAX_BYTES 또는 STORAGE_REDIS_PLAN_MAX_GB 로 플랜 데이터 상한 대비 비율 → 안전/부족우려/부족위험/확인불가.
 *       Upstash 콘솔 Details의 Storage와 같은 용량 축입니다. 키(DBSIZE)는 참고.
 * Resend: API 키 존재 여부만 확인(할량은 대시보드).
 */

const { verifyToken, apiResponse } = require('../_utils');

const BYTES_PER_GB = 1073741824;

function parseRatioEnv(name, defaultVal) {
  const raw = process.env[name];
  if (raw == null || String(raw).trim() === '') return defaultVal;
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0 || n > 1) return defaultVal;
  return n;
}

function parsePositiveBytes(name) {
  const raw = process.env[name];
  if (raw == null || String(raw).trim() === '') return null;
  const n = Math.floor(Number(raw));
  return Number.isFinite(n) && n > 0 ? n : null;
}

/**
 * @returns {{ maxBytes: number, planLabel: string } | { maxBytes: null, planLabel: null }}
 */
function resolveRedisPlanLimit() {
  const direct = parsePositiveBytes('STORAGE_REDIS_PLAN_MAX_BYTES');
  if (direct != null) {
    return {
      maxBytes: direct,
      planLabel: `${formatBytes(direct)} (STORAGE_REDIS_PLAN_MAX_BYTES)`,
    };
  }
  const raw = process.env.STORAGE_REDIS_PLAN_MAX_GB;
  if (raw == null || String(raw).trim() === '') return { maxBytes: null, planLabel: null };
  const gb = Number(raw);
  if (!Number.isFinite(gb) || gb <= 0) return { maxBytes: null, planLabel: null };
  const maxBytes = Math.floor(gb * BYTES_PER_GB);
  const gbStr = Number.isInteger(gb) ? String(Math.floor(gb)) : String(gb);
  return {
    maxBytes,
    planLabel: `${gbStr} GB (STORAGE_REDIS_PLAN_MAX_GB)`,
  };
}

/** @returns {'safe'|'concern'|'risk'|'unknown'} */
function levelFromUsageRatio(ratio, warnRatio, riskRatio) {
  if (!Number.isFinite(ratio) || ratio < 0) return 'unknown';
  if (ratio >= riskRatio) return 'risk';
  if (ratio >= warnRatio) return 'concern';
  return 'safe';
}

/** INFO memory 문자열에서 used_memory 바이트 */
function parseUsedMemoryBytes(infoStr) {
  if (typeof infoStr !== 'string') return null;
  const lines = infoStr.split(/\r?\n/);
  for (const line of lines) {
    if (line.startsWith('used_memory:')) {
      const v = line.slice('used_memory:'.length).trim();
      const n = Math.floor(Number(v));
      if (Number.isFinite(n) && n >= 0) return n;
    }
  }
  return null;
}

/**
 * @returns {Promise<{ ok: true, usedMemoryBytes: number, dbsize: number } | { ok: false, error: string }>}
 */
async function fetchUpstashRedisStats() {
  const base = String(process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL || '').trim().replace(/\/$/, '');
  const token = String(process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN || '').trim();
  if (!base || !token) return { ok: false, error: 'not_configured' };

  const headers = {
    Authorization: `Bearer ${token}`,
    'Content-Type': 'application/json',
  };

  async function exec(cmd) {
    const res = await fetch(base, {
      method: 'POST',
      headers,
      body: JSON.stringify(cmd),
    });
    const body = await res.json().catch(() => null);
    return { res, body };
  }

  let usedMemoryBytes = null;
  let dbsize = null;

  try {
    const pipRes = await fetch(`${base}/pipeline`, {
      method: 'POST',
      headers,
      body: JSON.stringify([['INFO', 'memory'], ['DBSIZE']]),
    });
    const pipBody = await pipRes.json().catch(() => null);
    if (pipRes.ok && Array.isArray(pipBody) && pipBody.length >= 2) {
      const memEntry = pipBody[0];
      const sizeEntry = pipBody[1];
      if (memEntry && !memEntry.error && typeof memEntry.result === 'string') {
        usedMemoryBytes = parseUsedMemoryBytes(memEntry.result);
      }
      if (sizeEntry && !sizeEntry.error && sizeEntry.result != null) {
        const n = Math.floor(Number(sizeEntry.result));
        if (Number.isFinite(n) && n >= 0) dbsize = n;
      }
    }
  } catch (_) {
    /* fall through to single commands */
  }

  if (usedMemoryBytes == null) {
    const r = await exec(['INFO', 'memory']);
    if (r.res.ok && r.body && !r.body.error && typeof r.body.result === 'string') {
      usedMemoryBytes = parseUsedMemoryBytes(r.body.result);
    }
  }
  if (dbsize == null || !Number.isFinite(dbsize)) {
    const r = await exec(['DBSIZE']);
    if (r.res.ok && r.body && r.body.result != null) {
      const n = Math.floor(Number(r.body.result));
      if (Number.isFinite(n) && n >= 0) dbsize = n;
    }
  }

  if (usedMemoryBytes == null && (dbsize == null || !Number.isFinite(dbsize))) {
    return { ok: false, error: 'probe_failed' };
  }
  if (usedMemoryBytes == null) usedMemoryBytes = 0;
  if (dbsize == null || !Number.isFinite(dbsize)) dbsize = 0;

  return { ok: true, usedMemoryBytes, dbsize };
}

function formatBytes(n) {
  const x = Math.max(0, Math.floor(Number(n)) || 0);
  if (x >= 1073741824) return `${(x / 1073741824).toFixed(2)} GB`;
  if (x >= 1048576) return `${(x / 1048576).toFixed(2)} MB`;
  if (x >= 1024) return `${(x / 1024).toFixed(1)} KB`;
  return `${x} B`;
}

module.exports = async (req, res) => {
  if (req.method === 'OPTIONS') return apiResponse(res, 200, {});
  if (req.method !== 'GET') return apiResponse(res, 405, { error: 'Method not allowed' });

  try {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return apiResponse(res, 401, { error: '로그인이 필요합니다.' });
    }
    const user = verifyToken(authHeader.substring(7));
    if (!user) return apiResponse(res, 401, { error: '로그인이 필요합니다.' });
    if (user.level !== 'admin') return apiResponse(res, 403, { error: '관리자만 접근할 수 있습니다.' });

    const warnRatio = parseRatioEnv('STORAGE_REDIS_WARN_RATIO', 0.7);
    const riskRatio = parseRatioEnv('STORAGE_REDIS_RISK_RATIO', 0.9);
    const redisLimit = resolveRedisPlanLimit();

    const items = [];
    const checkedAt = new Date().toISOString();

    const redisProbe = await fetchUpstashRedisStats();
    if (!redisProbe.ok) {
      items.push({
        id: 'redis',
        name: 'Upstash Redis',
        level: redisProbe.error === 'not_configured' ? 'unknown' : 'risk',
        detail:
          redisProbe.error === 'not_configured'
            ? 'Redis URL/토큰 환경 변수가 없습니다.'
            : `메모리·키 조회 실패 (${redisProbe.error}).`,
        hint:
          redisProbe.error === 'not_configured'
            ? 'Vercel에 KV_REST_API_URL / KV_REST_API_TOKEN(또는 UPSTASH_*)를 설정하세요.'
            : 'Upstash 콘솔에서 DB 상태와 토큰을 확인하세요.',
      });
    } else {
      const { usedMemoryBytes, dbsize } = redisProbe;
      let level = 'unknown';
      let detail = `데이터 메모리(used_memory) ${formatBytes(usedMemoryBytes)} · 키(DBSIZE) ${dbsize.toLocaleString('ko-KR')}개(운영 참고)`;
      let hint =
        'Redis 단계(안전·부족우려·부족위험)를 쓰려면 Vercel에 STORAGE_REDIS_PLAN_MAX_GB(예: Upstash Pay as you go 100GB → 100) 또는 STORAGE_REDIS_PLAN_MAX_BYTES를 넣으세요. Upstash Details의 Storage와 같은 용량 기준입니다.';

      if (redisLimit.maxBytes != null) {
        const ratio = usedMemoryBytes / redisLimit.maxBytes;
        level = levelFromUsageRatio(ratio, warnRatio, riskRatio);
        detail = [
          `데이터 메모리(used_memory) ${formatBytes(usedMemoryBytes)} — Upstash 콘솔 Storage와 같은 용량 축입니다.`,
          `플랜 데이터 상한 ${redisLimit.planLabel} 대비 약 ${(ratio * 100).toFixed(2)}% 사용 중입니다.`,
          `키(DBSIZE) ${dbsize.toLocaleString('ko-KR')}개(키 수는 플랜 용량과 별개 참고 지표).`,
        ].join(' ');
        const pctRisk = Math.round(riskRatio * 100);
        const pctWarn = Math.round(warnRatio * 100);
        if (ratio >= riskRatio) {
          hint = `플랜 데이터 상한의 ${pctRisk}% 이상입니다. Upstash 해당 DB → Details → Storage를 확인하고, 만료·데이터 정리 또는 플랜 조정을 검토하세요.`;
        } else if (ratio >= warnRatio) {
          hint = `플랜 데이터 상한의 ${pctWarn}% 이상입니다. Upstash Storage 사용량 추이를 함께 확인하세요.`;
        } else {
          hint = null;
        }
      }

      items.push({
        id: 'redis',
        name: 'Upstash Redis',
        level,
        detail,
        hint,
      });
    }

    const hasResend = Boolean(String(process.env.RESEND_API_KEY || '').trim());
    items.push({
      id: 'resend',
      name: 'Resend (이메일)',
      level: hasResend ? 'safe' : 'risk',
      detail: hasResend ? 'RESEND_API_KEY 가 설정되어 있습니다.' : 'RESEND_API_KEY 가 비어 있습니다.',
      hint: hasResend
        ? '월간 발송 한도·잔여 크레딧은 Resend 대시보드에서 확인하세요.'
        : 'Vercel 환경 변수에 RESEND_API_KEY 를 설정하세요.',
    });

    return apiResponse(res, 200, { checkedAt, items });
  } catch (e) {
    console.error('storage-status:', e);
    return apiResponse(res, 500, { error: '저장소 상태를 불러오지 못했습니다.' });
  }
};
