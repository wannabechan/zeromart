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

function normalizeApiEmail(email) {
  const toRaw = Array.isArray(email.to) && email.to[0] ? email.to[0] : '';
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
  if (!key || !String(key).trim()) return [];

  const cutoff = Date.now() - RESEND_LOG_RETENTION_MS;
  const rawAll = [];
  let after;
  let pages = 0;
  const MAX_PAGES = 30;

  while (pages < MAX_PAGES) {
    pages += 1;
    const qs = new URLSearchParams({ limit: '100' });
    if (after) qs.set('after', after);

    const res = await fetch(`${RESEND_LIST_URL}?${qs}`, {
      headers: { Authorization: `Bearer ${key}` },
    });
    if (!res.ok) {
      const err = new Error(`Resend list API HTTP ${res.status}`);
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
  return filtered.slice(0, RESEND_LOG_MAX_FETCH).map(normalizeApiEmail);
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
  let apiRows = [];
  try {
    apiRows = await fetchResendSentFromApi();
  } catch (e) {
    console.error('getMergedResendLogsForAdmin: Resend API list failed:', e.message || e);
    return redisLogs;
  }
  if (apiRows.length === 0) {
    return redisLogs.slice(0, RESEND_LOG_MAX_FETCH);
  }
  return mergeResendLogs(redisLogs, apiRows);
}

module.exports = {
  getMergedResendLogsForAdmin,
};
