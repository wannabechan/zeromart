/**
 * Redis 앱 로그 + Resend List Emails API 병합 (최근 30일, 상한 500건)
 */

const { getResendLogsForAdmin, maskEmailForResendLog } = require('./_redis');

const RESEND_LOG_RETENTION_MS = 30 * 24 * 60 * 60 * 1000;
const RESEND_LOG_MAX_FETCH = 500;

const RESEND_LIST_URL = 'https://api.resend.com/emails';

function inferKindFromSubject(subject) {
  const s = String(subject || '');
  if (s.includes('로그인 인증 코드')) return 'login_code';
  if (s.includes('Zero Mart 신규 주문')) return 'order_notification';
  return 'other';
}

function lastEventToOk(lastEvent) {
  if (lastEvent == null || lastEvent === '') return true;
  const fail = new Set(['failed', 'bounced', 'complained', 'canceled']);
  return !fail.has(String(lastEvent).toLowerCase());
}

function pickResendApiToRaw(email) {
  const t = email && email.to;
  if (Array.isArray(t) && t[0]) return String(t[0]);
  if (typeof t === 'string' && t.trim()) return t.trim();
  return '';
}

function normalizeApiEmail(email) {
  const toRaw = pickResendApiToRaw(email);
  const ok = lastEventToOk(email.last_event);
  return {
    id: `api:${email.id}`,
    at: email.created_at,
    ok,
    kind: inferKindFromSubject(email.subject),
    to: maskEmailForResendLog(toRaw),
    resendId: email.id,
    error: ok ? null : String(email.last_event || ''),
  };
}

async function fetchResendSentFromApi() {
  const key = process.env.RESEND_API_KEY;
  if (!key || !String(key).trim()) {
    return {
      rows: [],
      status: 'no_key',
      message:
        '서버 환경 변수 RESEND_API_KEY가 없어 Resend API에서 발송 목록을 가져오지 못했습니다. Vercel 등에 키를 설정한 뒤 다시 배포해 주세요.',
    };
  }

  const cutoff = Date.now() - RESEND_LOG_RETENTION_MS;
  const rawAll = [];
  let after;
  let pages = 0;
  const MAX_PAGES = 30;

  try {
    while (pages < MAX_PAGES) {
      pages += 1;
      const qs = new URLSearchParams({ limit: '100' });
      if (after) qs.set('after', after);

      const res = await fetch(`${RESEND_LIST_URL}?${qs}`, {
        headers: { Authorization: `Bearer ${key}` },
      });
      if (!res.ok) {
        let detail = '';
        try {
          const errBody = await res.json();
          detail = errBody && errBody.message ? String(errBody.message) : '';
        } catch (_) {}
        const err = new Error(detail || `HTTP ${res.status}`);
        err.status = res.status;
        throw err;
      }
      const body = await res.json();
      const data = Array.isArray(body.data) ? body.data : [];
      if (data.length === 0) break;

      rawAll.push(...data);

      const inWindow = rawAll.filter((email) => {
        const ts = new Date(email.created_at).getTime();
        return !Number.isNaN(ts) && ts >= cutoff;
      });
      if (inWindow.length >= RESEND_LOG_MAX_FETCH) break;
      if (!body.has_more) break;

      after = data[data.length - 1].id;
    }

    const filtered = rawAll.filter((email) => {
      const ts = new Date(email.created_at).getTime();
      return !Number.isNaN(ts) && ts >= cutoff;
    });
    filtered.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
    const rows = filtered.slice(0, RESEND_LOG_MAX_FETCH).map(normalizeApiEmail);
    return { rows, status: 'ok', message: null };
  } catch (e) {
    const statusCode = e.status || e.statusCode;
    let message =
      'Resend 발송 목록 API 호출에 실패했습니다. RESEND_API_KEY가 Resend 대시보드의 발송에 쓰는 키와 동일한지, 그리고 목록 조회가 가능한 키(Full access 권장)인지 확인해 주세요.';
    if (statusCode === 401 || statusCode === 403) {
      message =
        'Resend API가 목록 조회를 거부했습니다(401/403). Permission이 Sending access인 키는 이메일 발송만 가능하고, 어드민 발송 목록에 쓰는 GET /emails(목록) 조회는 할 수 없습니다. Resend 대시보드에서 Full access API 키를 새로 만들어 Vercel의 RESEND_API_KEY에 넣어 주세요. (발송용 Sending 키와 별도로 두어도 됩니다.)';
    }
    if (e.message && String(e.message).trim()) {
      message += ` (${String(e.message).slice(0, 200)})`;
    }
    console.error('fetchResendSentFromApi:', e);
    return { rows: [], status: 'error', message };
  }
}

function mergeResendLogs(redisLogs, apiRows) {
  const apiIds = new Set(apiRows.map((r) => r.resendId).filter(Boolean));
  const redisByResendId = new Map();
  for (const r of redisLogs) {
    if (r.resendId) redisByResendId.set(r.resendId, r);
  }

  const mergedApi = apiRows.map((apiRow) => {
    const redisMatch = redisByResendId.get(apiRow.resendId);
    if (!redisMatch) return apiRow;
    return {
      ...apiRow,
      kind: redisMatch.kind || apiRow.kind,
      to: redisMatch.to || apiRow.to,
    };
  });

  const extras = [];
  for (const r of redisLogs) {
    if (!r.resendId) {
      extras.push(r);
      continue;
    }
    if (!apiIds.has(r.resendId)) {
      extras.push(r);
    }
  }

  const combined = [...mergedApi, ...extras];
  combined.sort((a, b) => {
    const ta = new Date(a.at).getTime();
    const tb = new Date(b.at).getTime();
    if (Number.isNaN(ta) && Number.isNaN(tb)) return 0;
    if (Number.isNaN(ta)) return 1;
    if (Number.isNaN(tb)) return -1;
    return tb - ta;
  });

  return combined.slice(0, RESEND_LOG_MAX_FETCH);
}

async function getMergedResendLogsForAdmin() {
  const redisLogs = await getResendLogsForAdmin();
  const api = await fetchResendSentFromApi();

  let logs;
  if (api.status === 'ok' && api.rows.length > 0) {
    logs = mergeResendLogs(redisLogs, api.rows);
  } else {
    logs = redisLogs.slice(0, RESEND_LOG_MAX_FETCH);
  }

  return {
    logs,
    resendListSync: api.status,
    resendListSyncMessage: api.message,
  };
}

module.exports = {
  getMergedResendLogsForAdmin,
};
