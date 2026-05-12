/**
 * Redis (Upstash) 데이터 레이어
 * Key 구조:
 * - user:{email} = JSON 사용자 정보 (zero_point: 제로포인트 잔액, 정수)
 * - auth:code:{email} = 6자리 코드 (TTL 10분)
 * - orders:count:{yymmdd} = 해당일 주문 건수 (INCR)
 * - order:{id} = JSON 주문 정보 (id = yymmdd000 형식)
 * - orders:by_user:{email} = Sorted Set (score=timestamp, member=orderId)
 */

const crypto = require('crypto');
const { Redis } = require('@upstash/redis');
const { getUserLevel } = require('./_utils');

/** Resend 발송 메타 로그 (sorted set, score = 시각 ms, member = JSON) */
const RESEND_LOGS_ZSET = 'resend:send_logs';
const RESEND_LOG_RETENTION_MS = 30 * 24 * 60 * 60 * 1000;
const RESEND_LOG_MAX_FETCH = 500;

function normalizeResendLogRecipientEmail(email) {
  const e = String(email || '').trim().toLowerCase();
  if (!e || !e.includes('@')) return '—';
  return e;
}

async function appendResendLog({ ok, kind, toEmail, resendId, errorMessage }) {
  try {
    const redis = getRedis();
    const at = Date.now();
    const id = `${at}-${crypto.randomBytes(6).toString('hex')}`;
    const payload = JSON.stringify({
      id,
      at: new Date(at).toISOString(),
      ok: !!ok,
      kind: kind || 'unknown',
      to: normalizeResendLogRecipientEmail(toEmail),
      resendId: resendId || null,
      error: errorMessage ? String(errorMessage).slice(0, 500) : null,
    });
    await redis.zadd(RESEND_LOGS_ZSET, { score: at, member: payload });
    const cutoff = at - RESEND_LOG_RETENTION_MS;
    await redis.zremrangebyscore(RESEND_LOGS_ZSET, '-inf', cutoff);
  } catch (e) {
    console.error('appendResendLog:', e);
  }
}

async function getResendLogsForAdmin() {
  try {
    const redis = getRedis();
    const cutoff = Date.now() - RESEND_LOG_RETENTION_MS;
    await redis.zremrangebyscore(RESEND_LOGS_ZSET, '-inf', cutoff);
    const members = await redis.zrange(RESEND_LOGS_ZSET, 0, RESEND_LOG_MAX_FETCH - 1, { rev: true });
    const out = [];
    for (const m of members || []) {
      try {
        const row = typeof m === 'string' ? JSON.parse(m) : null;
        if (row) out.push(row);
      } catch (_) {}
    }
    return out;
  } catch (e) {
    console.error('getResendLogsForAdmin:', e);
    return [];
  }
}

let _redisClient = null;

function getRedis() {
  if (_redisClient) return _redisClient;
  const url = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN;
  if (!url || !token) {
    throw new Error('KV_REST_API_URL and KV_REST_API_TOKEN (or UPSTASH_* equivalents) are required');
  }
  _redisClient = new Redis({ url, token });
  return _redisClient;
}

function normalizeMenuItem(item) {
  if (!item || typeof item !== 'object') return item;
  return { ...item, isSoldOut: item.isSoldOut === true };
}

/**
 * 고정 윈도 레이트 리밋 (INCR + EXPIRE). 인증·주문·결제 등에서 공통 사용.
 * @returns {Promise<boolean>} 허용이면 true, 한도 초과면 false
 */
async function checkRateLimitIncr(key, limit, windowSeconds) {
  const redis = getRedis();
  const count = await redis.incr(key);
  if (count === 1) await redis.expire(key, windowSeconds);
  return count <= limit;
}

const CODE_TTL_SECONDS = 120; // 2분
const BUSINESS_HOURS_SLOTS = ['09:00-10:00', '10:00-11:00', '11:00-12:00', '12:00-13:00', '13:00-14:00', '14:00-15:00', '15:00-16:00', '16:00-17:00', '17:00-18:00', '18:00-19:00', '19:00-20:00', '20:00-21:00'];

function normalizeCode(input) {
  return String(input || '').replace(/\D/g, '').slice(0, 6);
}

async function saveAuthCode(email, code) {
  const redis = getRedis();
  const key = `auth:code:${email}`;
  await redis.set(key, String(code), { ex: CODE_TTL_SECONDS });
}

async function getAndDeleteAuthCode(email, code) {
  const redis = getRedis();
  const key = `auth:code:${email}`;
  const stored = await redis.get(key);
  const normalizedInput = normalizeCode(code);
  const normalizedStored = String(stored || '').replace(/\D/g, '');
  if (normalizedInput.length !== 6 || normalizedInput !== normalizedStored) {
    return false;
  }
  await redis.del(key);
  return true;
}

async function getUser(email) {
  const redis = getRedis();
  const raw = await redis.get(`user:${email}`);
  if (!raw) return null;
  return typeof raw === 'string' ? JSON.parse(raw) : raw;
}

async function createUser(email, level) {
  const redis = getRedis();
  const user = {
    email,
    level,
    created_at: new Date().toISOString(),
    last_login: null,
    is_first_login: true,
  };
  await redis.set(`user:${email}`, JSON.stringify(user));
  return user;
}

async function updateUserLogin(email) {
  const redis = getRedis();
  const raw = await redis.get(`user:${email}`);
  if (!raw) return null;
  const user = typeof raw === 'string' ? JSON.parse(raw) : raw;
  const isFirstLogin = user.is_first_login === true;
  user.last_login = new Date().toISOString();
  user.is_first_login = false;
  await redis.set(`user:${email}`, JSON.stringify(user));
  return { ...user, is_first_login: isFirstLogin };
}

/** 환경 변수 EMAIL_ADMIN 변경 시 기존 사용자 레벨 동기화 */
async function updateUserLevel(email, level) {
  const redis = getRedis();
  const raw = await redis.get(`user:${email}`);
  if (!raw) return null;
  const user = typeof raw === 'string' ? JSON.parse(raw) : raw;
  user.level = level;
  await redis.set(`user:${email}`, JSON.stringify(user));
  return user;
}

function recomputeZeroPointBalanceFromGrants(user) {
  const arr = Array.isArray(user.zero_point_grants) ? user.zero_point_grants : [];
  let s = 0;
  for (const g of arr) {
    s += Math.max(0, Math.floor(Number(g.remaining)) || 0);
  }
  user.zero_point = s;
}

function consumeGrantsFifoMutate(user, amountToConsume) {
  const amt = Math.floor(Number(amountToConsume));
  if (!Number.isFinite(amt) || amt < 1) return;
  const grants = Array.isArray(user.zero_point_grants) ? [...user.zero_point_grants] : [];
  grants.sort((a, b) => new Date(a.awardedAt).getTime() - new Date(b.awardedAt).getTime());
  let left = amt;
  for (const g of grants) {
    if (left <= 0) break;
    const r = Math.max(0, Math.floor(Number(g.remaining)) || 0);
    if (r <= 0) continue;
    const take = Math.min(r, left);
    g.remaining = r - take;
    left -= take;
  }
  user.zero_point_grants = grants;
  recomputeZeroPointBalanceFromGrants(user);
}

const MAX_ZERO_POINT_HISTORY = 400;

/** @param {object} user - mutated in memory */
function appendZeroPointHistoryOnUser(user, entry) {
  const code = String(entry.code || '').trim();
  const delta = Math.floor(Number(entry.delta));
  if (!code || !Number.isFinite(delta) || delta === 0) return;
  const arr = Array.isArray(user.zero_point_history) ? user.zero_point_history : [];
  arr.unshift({
    ts: entry.ts || new Date().toISOString(),
    code,
    delta,
    orderId: entry.orderId != null && entry.orderId !== '' ? String(entry.orderId) : null,
  });
  user.zero_point_history = arr.slice(0, MAX_ZERO_POINT_HISTORY);
}

/** 주문·코드·증감 단위로 중복 제거(백필 파생 이력 vs Redis 저장분) */
function zeroPointHistoryDedupeKey(ev) {
  const oid = ev.orderId != null && ev.orderId !== '' ? String(ev.orderId) : '-';
  const code = String(ev.code || '').trim();
  const delta = Number.isFinite(Number(ev.delta)) ? Math.floor(Number(ev.delta)) : 0;
  return `${code}|${oid}|${delta}`;
}

function normalizeZeroPointHistoryEvent(ev) {
  return {
    ts: ev.ts != null ? String(ev.ts) : null,
    code: String(ev.code || '').trim(),
    delta: Number.isFinite(Number(ev.delta)) ? Math.floor(Number(ev.delta)) : 0,
    orderId: ev.orderId != null && ev.orderId !== '' ? String(ev.orderId) : null,
  };
}

/** send-order-notifications 의 적립 종류와 동일 규칙 */
function deriveEarnCodeFromOrder(order) {
  const k = order.zero_point_reward_kind;
  if (k === 'easypay') return 'earn_easypay';
  if (k === 'credit') return 'earn_credit';
  if (order.zero_point_reward_eligible === true) return 'earn_credit';
  return 'earn_credit';
}

/**
 * 주문 JSON만으로 과거 이벤트 복원(배포 전 이력 보강). 실시간 append 와 중복 시 저장분 우선.
 * @param {object[]} orders - getOrdersByUser 결과
 */
function buildDerivedZeroPointHistoryFromOrders(orders) {
  const out = [];
  if (!Array.isArray(orders)) return out;
  for (const o of orders) {
    if (!o || o.id == null) continue;
    const orderId = String(o.id);
    const used = Math.floor(Number(o.zero_point_used)) || 0;
    if (used > 0) {
      const tsUse = o.created_at ? String(o.created_at) : new Date().toISOString();
      out.push(normalizeZeroPointHistoryEvent({ ts: tsUse, code: 'use_order', delta: -used, orderId }));
    }
    const earned = Math.floor(Number(o.zero_point_earned)) || 0;
    if (earned > 0) {
      const tsEarn = o.zero_point_awarded_at || o.payment_completed_at || o.created_at;
      if (tsEarn) {
        out.push(
          normalizeZeroPointHistoryEvent({
            ts: String(tsEarn),
            code: deriveEarnCodeFromOrder(o),
            delta: earned,
            orderId,
          }),
        );
      }
    }
    if ((o.status || '') === 'cancelled' && o.zero_point_refunded && used > 0) {
      const tPay = o.payment_completed_at ? new Date(o.payment_completed_at).getTime() : NaN;
      const tAward = o.zero_point_awarded_at ? new Date(o.zero_point_awarded_at).getTime() : NaN;
      const tCreate = o.created_at ? new Date(o.created_at).getTime() : 0;
      const nums = [tPay, tAward, tCreate].filter((x) => Number.isFinite(x) && x > 0);
      const tMs = nums.length ? Math.max(...nums) : Date.now();
      out.push(
        normalizeZeroPointHistoryEvent({
          ts: new Date(tMs).toISOString(),
          code: 'refund_cancel',
          delta: used,
          orderId,
        }),
      );
    }
  }
  return out;
}

async function appendZeroPointHistory(email, entry) {
  const e = String(email || '').trim().toLowerCase();
  if (!e || !e.includes('@')) return;
  const redis = getRedis();
  const raw = await redis.get(`user:${e}`);
  if (!raw) return;
  const user = typeof raw === 'string' ? JSON.parse(raw) : raw;
  appendZeroPointHistoryOnUser(user, entry);
  await redis.set(`user:${e}`, JSON.stringify(user));
}

/** @returns {Promise<Array<{ ts: string|null, code: string, delta: number, orderId: string|null }>>} */
async function getZeroPointHistoryByEmail(email) {
  const e = String(email || '').trim().toLowerCase();
  if (!e || !e.includes('@')) return [];

  const orders = await getOrdersByUser(e);
  const derived = buildDerivedZeroPointHistoryFromOrders(orders);

  const redis = getRedis();
  const raw = await redis.get(`user:${e}`);
  let stored = [];
  if (raw) {
    const user = typeof raw === 'string' ? JSON.parse(raw) : raw;
    const arr = Array.isArray(user.zero_point_history) ? user.zero_point_history : [];
    stored = arr.map((ev) => normalizeZeroPointHistoryEvent(ev));
  }

  const byKey = new Map();
  for (const ev of stored) {
    if (!ev.code || ev.delta === 0) continue;
    byKey.set(zeroPointHistoryDedupeKey(ev), ev);
  }
  for (const ev of derived) {
    if (!ev.code || ev.delta === 0) continue;
    const k = zeroPointHistoryDedupeKey(ev);
    if (!byKey.has(k)) byKey.set(k, ev);
  }

  const merged = Array.from(byKey.values()).sort((a, b) => {
    const ta = a.ts ? new Date(a.ts).getTime() : 0;
    const tb = b.ts ? new Date(b.ts).getTime() : 0;
    return tb - ta;
  });
  return merged.slice(0, MAX_ZERO_POINT_HISTORY);
}

/**
 * 주문 적립 이력으로 zero_point_grants 복구 (잔액과 FIFO 사용분 일치).
 * @param {object} [opts]
 * @param {string} [opts.excludeOrderId] 적립 직전 addUserZeroPoints 호출 시 해당 주문은 합계에서 제외(이중 계산 방지)
 */
async function migrateZeroPointGrantsFromOrdersIfNeeded(email, opts = {}) {
  const e = String(email || '').trim().toLowerCase();
  if (!e || !e.includes('@')) return;
  const excludeOrderId = opts.excludeOrderId != null ? String(opts.excludeOrderId).trim() : '';
  const redis = getRedis();
  const raw = await redis.get(`user:${e}`);
  if (!raw) return;
  const user = typeof raw === 'string' ? JSON.parse(raw) : raw;
  const bal = Math.max(0, Math.floor(Number(user.zero_point)) || 0);
  const existing = Array.isArray(user.zero_point_grants) ? user.zero_point_grants : [];
  const sumRem = existing.reduce((s, g) => s + Math.max(0, Math.floor(Number(g.remaining)) || 0), 0);
  if (existing.length > 0 && sumRem === bal) return;

  const orders = await getOrdersByUser(e);
  const grants = [];
  for (const o of orders) {
    if (excludeOrderId && String(o.id) === excludeOrderId) continue;
    const earned = Math.floor(Number(o.zero_point_earned)) || 0;
    if (earned <= 0) continue;
    const awardedAt = o.zero_point_awarded_at || o.payment_completed_at;
    if (!awardedAt) continue;
    grants.push({
      sourceOrderId: String(o.id),
      amount: earned,
      awardedAt: String(awardedAt),
      remaining: earned,
    });
  }
  grants.sort((a, b) => new Date(a.awardedAt).getTime() - new Date(b.awardedAt).getTime());
  const sumEarned = grants.reduce((s, g) => s + g.remaining, 0);
  let used = Math.max(0, sumEarned - bal);
  for (const g of grants) {
    if (used <= 0) break;
    const r = g.remaining;
    if (r <= 0) continue;
    const take = Math.min(r, used);
    g.remaining = r - take;
    used -= take;
  }
  if (grants.length === 0 && bal > 0) {
    grants.push({
      sourceOrderId: '_legacy',
      amount: bal,
      awardedAt: new Date().toISOString(),
      remaining: bal,
    });
  }
  user.zero_point_grants = grants;
  await redis.set(`user:${e}`, JSON.stringify(user));
}

/**
 * 적립 발생일(zero_point_awarded_at) 기준 PAYMENT_REWARD_EXPIREDAYS 경과분 소멸.
 * @returns {number} 해당 사용자에서 소멸된 포인트 합
 */
async function expireUserZeroPointsByPolicy(email, expireDays) {
  const e = String(email || '').trim().toLowerCase();
  if (!e || !e.includes('@')) return 0;
  const days = Math.floor(Number(expireDays));
  if (!Number.isFinite(days) || days < 1) return 0;
  await migrateZeroPointGrantsFromOrdersIfNeeded(e);
  const redis = getRedis();
  const raw = await redis.get(`user:${e}`);
  if (!raw) return 0;
  const user = typeof raw === 'string' ? JSON.parse(raw) : raw;
  const expireMs = days * 86400000;
  const now = Date.now();
  let expired = 0;
  const grants = Array.isArray(user.zero_point_grants) ? user.zero_point_grants : [];
  for (const g of grants) {
    const rem = Math.max(0, Math.floor(Number(g.remaining)) || 0);
    if (rem <= 0) continue;
    const t = new Date(g.awardedAt).getTime();
    if (Number.isNaN(t) || now - t < expireMs) continue;
    g.remaining = 0;
    expired += rem;
  }
  if (expired <= 0) return 0;
  appendZeroPointHistoryOnUser(user, {
    code: 'expire',
    delta: -expired,
    ts: new Date().toISOString(),
    orderId: null,
  });
  recomputeZeroPointBalanceFromGrants(user);
  await redis.set(`user:${e}`, JSON.stringify(user));
  return expired;
}

async function listUserEmailsFromRedis() {
  const redis = getRedis();
  const keys = await redis.keys('user:*');
  if (!keys || keys.length === 0) return [];
  return keys
    .map((k) => String(k).replace(/^user:/i, ''))
    .filter((em) => em.includes('@'));
}

async function expireAllUsersZeroPointsByPolicy(expireDays) {
  const emails = await listUserEmailsFromRedis();
  let pointsExpired = 0;
  let usersTouched = 0;
  for (const email of emails) {
    const n = await expireUserZeroPointsByPolicy(email, expireDays);
    if (n > 0) {
      pointsExpired += n;
      usersTouched += 1;
    }
  }
  return { checked: emails.length, pointsExpired, usersTouched };
}

/** 로그인 사용자 Redis 문서에 제로포인트(정수)를 더함. user 없으면 null. meta: { sourceOrderId?, awardedAt?, historyCode?: 'earn_credit'|'earn_easypay' } */
async function addUserZeroPoints(email, pointsDelta, meta = {}) {
  const e = String(email || '').trim().toLowerCase();
  if (!e) return null;
  const delta = Math.floor(Number(pointsDelta));
  if (!Number.isFinite(delta) || delta < 1) return null;
  const m = meta && typeof meta === 'object' ? meta : {};
  await migrateZeroPointGrantsFromOrdersIfNeeded(e, { excludeOrderId: m.sourceOrderId });
  const redis = getRedis();
  const raw = await redis.get(`user:${e}`);
  if (!raw) {
    console.warn('addUserZeroPoints: user not found', e);
    return null;
  }
  const user = typeof raw === 'string' ? JSON.parse(raw) : raw;
  const grants = Array.isArray(user.zero_point_grants) ? user.zero_point_grants : [];
  grants.push({
    sourceOrderId: m.sourceOrderId != null ? String(m.sourceOrderId) : null,
    amount: delta,
    awardedAt: m.awardedAt || new Date().toISOString(),
    remaining: delta,
  });
  user.zero_point_grants = grants;
  recomputeZeroPointBalanceFromGrants(user);
  if (m.historyCode === 'earn_credit' || m.historyCode === 'earn_easypay') {
    appendZeroPointHistoryOnUser(user, {
      ts: m.awardedAt || new Date().toISOString(),
      code: m.historyCode,
      delta,
      orderId: m.sourceOrderId != null ? String(m.sourceOrderId) : null,
    });
  }
  await redis.set(`user:${e}`, JSON.stringify(user));
  return user.zero_point;
}

/**
 * 주문 결제에 사용할 제로포인트 차감 (정수, 양수만).
 * @returns {{ ok: true, balance: number } | { ok: false, error: string }}
 */
async function deductUserZeroPoints(email, amount) {
  const e = String(email || '').trim().toLowerCase();
  const amt = Math.floor(Number(amount));
  if (!e || !Number.isFinite(amt) || amt < 1) return { ok: false, error: 'invalid_amount' };
  await migrateZeroPointGrantsFromOrdersIfNeeded(e);
  const redis = getRedis();
  const raw = await redis.get(`user:${e}`);
  if (!raw) return { ok: false, error: 'user_not_found' };
  const user = typeof raw === 'string' ? JSON.parse(raw) : raw;
  const sumRem = (Array.isArray(user.zero_point_grants) ? user.zero_point_grants : []).reduce(
    (s, g) => s + Math.max(0, Math.floor(Number(g.remaining)) || 0),
    0,
  );
  if (!Number.isFinite(sumRem) || sumRem < amt) return { ok: false, error: 'insufficient_balance' };
  consumeGrantsFifoMutate(user, amt);
  await redis.set(`user:${e}`, JSON.stringify(user));
  return { ok: true, balance: user.zero_point };
}

/**
 * 주문 취소 등으로 사용했던 제로포인트 환불 (정수, 양수만).
 * @returns {{ ok: true, balance: number } | { ok: false, error: string }}
 */
async function refundUserZeroPoints(email, amount, meta = {}) {
  const e = String(email || '').trim().toLowerCase();
  const amt = Math.floor(Number(amount));
  if (!e || !Number.isFinite(amt) || amt < 1) return { ok: true, balance: null };
  await migrateZeroPointGrantsFromOrdersIfNeeded(e);
  const redis = getRedis();
  const raw = await redis.get(`user:${e}`);
  if (!raw) return { ok: false, error: 'user_not_found' };
  const user = typeof raw === 'string' ? JSON.parse(raw) : raw;
  const grants = Array.isArray(user.zero_point_grants) ? user.zero_point_grants : [];
  const awardedAt = new Date().toISOString();
  grants.push({
    sourceOrderId: '_refund',
    amount: amt,
    awardedAt,
    remaining: amt,
  });
  user.zero_point_grants = grants;
  recomputeZeroPointBalanceFromGrants(user);
  const m = meta && typeof meta === 'object' ? meta : {};
  appendZeroPointHistoryOnUser(user, {
    code: 'refund_cancel',
    delta: amt,
    ts: awardedAt,
    orderId: m.orderId != null && m.orderId !== '' ? String(m.orderId) : null,
  });
  await redis.set(`user:${e}`, JSON.stringify(user));
  return { ok: true, balance: user.zero_point };
}

function getYymmddKST() {
  const d = new Date();
  const formatter = new Intl.DateTimeFormat('ko-KR', {
    timeZone: 'Asia/Seoul',
    year: '2-digit',
    month: '2-digit',
    day: '2-digit',
  });
  const parts = formatter.formatToParts(d);
  const get = (type) => parts.find((p) => p.type === type)?.value || '';
  const y = get('year');
  const m = get('month');
  const day = get('day');
  return `${y}${m}${day}`;
}

async function getNextOrderId() {
  const redis = getRedis();
  const yymmdd = getYymmddKST();
  const count = await redis.incr(`orders:count:${yymmdd}`);
  return `${yymmdd}${String(count).padStart(3, '0')}`;
}

async function createOrder(orderData) {
  const redis = getRedis();
  const id = await getNextOrderId();
  const order = {
    id,
    ...orderData,
    status: 'submitted',
    created_at: new Date().toISOString(),
  };
  const key = `order:${id}`;
  await redis.set(key, JSON.stringify(order));
  const score = Date.now();
  await redis.zadd(`orders:by_user:${order.user_email}`, { score, member: String(id) });
  return order;
}

async function getOrdersByUser(email) {
  const redis = getRedis();
  const ids = await redis.zrange(`orders:by_user:${email}`, 0, -1, { rev: true });
  if (!ids || ids.length === 0) return [];
  const keys = ids.map((id) => `order:${id}`);
  const raws = await redis.mget(...keys);
  const orders = [];
  for (let i = 0; i < raws.length; i++) {
    const raw = raws[i];
    if (raw) {
      const order = typeof raw === 'string' ? JSON.parse(raw) : raw;
      orders.push(order);
    }
  }
  return orders;
}

async function getOrderById(orderId) {
  const redis = getRedis();
  const raw = await redis.get(`order:${orderId}`);
  if (!raw) return null;
  return typeof raw === 'string' ? JSON.parse(raw) : raw;
}

/** 주문 JSON 전체 저장 (슬립·부분 갱신 등) */
async function saveOrder(order) {
  const redis = getRedis();
  if (!order || order.id == null) return null;
  const id = String(order.id).trim();
  if (!id) return null;
  await redis.set(`order:${id}`, JSON.stringify(order));
  return order;
}

async function deleteOrder(orderId) {
  const redis = getRedis();
  const order = await getOrderById(orderId);
  if (!order) return false;
  await redis.del(`order:${orderId}`);
  await redis.zrem(`orders:by_user:${order.user_email}`, orderId);
  return true;
}

async function updateOrderStatus(orderId, status) {
  const redis = getRedis();
  const order = await getOrderById(orderId);
  if (!order) return null;
  if (status === 'payment_completed' && order.status !== 'payment_completed') {
    order.payment_completed_at = new Date().toISOString();
  }
  order.status = status;
  await redis.set(`order:${orderId}`, JSON.stringify(order));
  return order;
}

async function updateOrderCancelReason(orderId, cancelReason) {
  const redis = getRedis();
  const order = await getOrderById(orderId);
  if (!order) return null;
  order.cancel_reason = cancelReason || null;
  await redis.set(`order:${orderId}`, JSON.stringify(order));
  return order;
}

async function updateOrderPdfUrl(orderId, pdfUrl) {
  const redis = getRedis();
  const order = await getOrderById(orderId);
  if (!order) return null;
  order.pdf_url = pdfUrl;
  await redis.set(`order:${orderId}`, JSON.stringify(order));
  return order;
}

async function updateOrderPaymentLink(orderId, paymentLink) {
  const redis = getRedis();
  const order = await getOrderById(orderId);
  if (!order) return null;
  order.payment_link = paymentLink || '';
  if (!(paymentLink || '').trim() && order.status === 'payment_link_issued') {
    order.status = 'order_accepted';
  }
  await redis.set(`order:${orderId}`, JSON.stringify(order));
  return order;
}

async function updateOrderShippingNumber(orderId, trackingNumber) {
  const redis = getRedis();
  const order = await getOrderById(orderId);
  if (!order) return null;
  order.tracking_number = (trackingNumber || '').trim();
  if (order.status === 'payment_completed') {
    order.status = 'shipping';
  }
  await redis.set(`order:${orderId}`, JSON.stringify(order));
  return order;
}

/** 택배사·송장 저장 후 발송 완료로 변경 */
async function updateOrderParcelAndDeliveryComplete(orderId, courierCompany, trackingNumber) {
  const redis = getRedis();
  const order = await getOrderById(orderId);
  if (!order) return null;
  order.courier_company = (courierCompany || '').trim() || null;
  order.tracking_number = (trackingNumber || '').trim() || null;
  order.delivery_type = 'parcel';
  order.status = 'delivery_completed';
  await redis.set(`order:${orderId}`, JSON.stringify(order));
  return order;
}

/** 직접 배송 완료로 변경 (승인 코드 검증 후 호출) */
async function updateOrderDeliveryCompleteDirect(orderId) {
  const redis = getRedis();
  const order = await getOrderById(orderId);
  if (!order) return null;
  order.delivery_type = 'direct';
  order.status = 'delivery_completed';
  await redis.set(`order:${orderId}`, JSON.stringify(order));
  return order;
}

async function updateOrderAcceptToken(orderId, token) {
  const redis = getRedis();
  const order = await getOrderById(orderId);
  if (!order) return null;
  order.accept_token = token === undefined || token === null ? null : String(token);
  await redis.set(`order:${orderId}`, JSON.stringify(order));
  return order;
}

async function setOrderNotificationSent(orderId) {
  const redis = getRedis();
  const order = await getOrderById(orderId);
  if (!order) return null;
  order.order_notification_sent = true;
  await redis.set(`order:${orderId}`, JSON.stringify(order));
  return order;
}

async function updateOrderTossPaymentKey(orderId, paymentKey) {
  const redis = getRedis();
  const order = await getOrderById(orderId);
  if (!order) return null;
  order.toss_payment_key = paymentKey == null || paymentKey === '' ? null : String(paymentKey).trim();
  await redis.set(`order:${orderId}`, JSON.stringify(order));
  return order;
}

async function updateOrderUserAsOrderSent(orderId) {
  const redis = getRedis();
  const order = await getOrderById(orderId);
  if (!order) return null;
  order.user_as_order_sent = true;
  await redis.set(`order:${orderId}`, JSON.stringify(order));
  return order;
}

async function getAllOrders() {
  const redis = getRedis();
  const keys = await redis.keys('order:*');
  if (!keys || keys.length === 0) return [];
  const raws = await redis.mget(...keys);
  const orders = [];
  for (let i = 0; i < raws.length; i++) {
    const raw = raws[i];
    if (raw) {
      const order = typeof raw === 'string' ? JSON.parse(raw) : raw;
      orders.push(order);
    }
  }
  orders.sort((a, b) => new Date(a.created_at) - new Date(b.created_at));
  return orders;
}

/**
 * 어드민 포인트관리: 인증으로 생성된 user:* 계정, 이메일 오름차순.
 * 총 누적 = 주문에 기록된 zero_point_earned 합(결제 적립분만). 사용 = max(0, 총누적 − 현재 잔액).
 */
async function getAdminZeroPointUserRows() {
  const redis = getRedis();
  const keys = await redis.keys('user:*');
  if (!keys || keys.length === 0) return [];
  const emails = keys
    .map((k) => String(k).replace(/^user:/i, ''))
    .filter((e) => e.includes('@'));
  emails.sort((a, b) => a.localeCompare(b, 'en', { sensitivity: 'base' }));
  const userKeys = emails.map((e) => `user:${e}`);
  const raws = await redis.mget(...userKeys);
  const orders = await getAllOrders();
  const earnedByEmail = {};
  for (const o of orders) {
    const em = String(o.user_email || '').trim().toLowerCase();
    if (!em) continue;
    const z = Number(o.zero_point_earned);
    if (Number.isFinite(z) && z > 0) {
      earnedByEmail[em] = (earnedByEmail[em] || 0) + z;
    }
  }
  const rows = [];
  for (let i = 0; i < emails.length; i++) {
    const email = emails[i];
    const raw = raws[i];
    if (!raw) continue;
    let u;
    try {
      u = typeof raw === 'string' ? JSON.parse(raw) : raw;
    } catch (_) {
      continue;
    }
    const current = Number(u.zero_point) || 0;
    const safeCurrent = Number.isFinite(current) && current >= 0 ? Math.floor(current) : 0;
    const totalEarned = earnedByEmail[email] || 0;
    const usedPoints = Math.max(0, totalEarned - safeCurrent);
    rows.push({
      email,
      zero_point: safeCurrent,
      total_earned: totalEarned,
      used_points: usedPoints,
    });
  }
  return rows;
}

/**
 * 환경변수 ADMIN_USE_SAMPLE_ORDERS === 'true' 이면 샘플 주문 반환, 아니면 실제 DB 주문.
 * 어드민·매장담당자·브랜드매니저 API에서 공통 사용 (동일 샘플 데이터로 테스트 가능).
 */
async function getOrdersForAdmin() {
  if (String(process.env.ADMIN_USE_SAMPLE_ORDERS || '').trim().toLowerCase() === 'true') {
    const { getSampleOrders } = require('./_sample-orders');
    const stores = await getStores() || [];
    const menusByStore = {};
    for (const s of stores) {
      menusByStore[s.id] = await getMenus(s.id) || [];
    }
    return getSampleOrders(stores, menusByStore);
  }
  return getAllOrders();
}

// ===== Stores & Menus (Admin) =====

const STORES_KEY = 'app:stores';

const DEFAULT_STORES = [
  { id: 'bento', slug: 'bento', title: '도시락', payment: { apiKeyEnvVar: 'TOSS_SECRET_KEY' } },
  { id: 'side', slug: 'side', title: '반찬', payment: { apiKeyEnvVar: 'TOSS_SECRET_KEY' } },
  { id: 'salad', slug: 'salad', title: '샐러드', payment: { apiKeyEnvVar: 'TOSS_SECRET_KEY' } },
  { id: 'beverage', slug: 'beverage', title: '음료', payment: { apiKeyEnvVar: 'TOSS_SECRET_KEY' } },
  { id: 'dessert', slug: 'dessert', title: '디저트', payment: { apiKeyEnvVar: 'TOSS_SECRET_KEY' } },
];

const DEFAULT_MENUS = {
  bento: [
    { id: 'bento-1', name: '삼겹살 덮밥', price: 100000, description: '구운 삼겹살과 야채가 듬뿍 들어간 든든한 덮밥입니다.', imageUrl: '' },
    { id: 'bento-2', name: '불고기 덮밥', price: 8000, description: '달콤한 양념에 재운 불고기가 가득한 인기 메뉴입니다.', imageUrl: '' },
    { id: 'bento-3', name: '치킨까스 도시락', price: 7500, description: '바삭한 치킨 커틀릿과 신선한 채소가 들어있습니다.', imageUrl: '' },
    { id: 'bento-4', name: '제육덮밥', price: 7500, description: '매콤한 제육볶음이 올라간 밥입니다.', imageUrl: '' },
    { id: 'bento-5', name: '김치찌개 정식', price: 7000, description: '얼큰한 김치찌개와 밥, 반찬이 포함된 정식입니다.', imageUrl: '' },
    { id: 'bento-6', name: '연어덮밥', price: 9000, description: '신선한 연어와 아보카도가 올라간 프리미엄 덮밥입니다.', imageUrl: '' },
  ],
  side: [
    { id: 'side-1', name: '김치 (소)', price: 2000, description: '직접 담근 맛있는 배추김치 소량입니다.', imageUrl: '' },
    { id: 'side-2', name: '김치 (대)', price: 4000, description: '직접 담근 맛있는 배추김치 대량입니다.', imageUrl: '' },
    { id: 'side-3', name: '계란말이', price: 3000, description: '부드럽고 폭신한 계란말이입니다.', imageUrl: '' },
    { id: 'side-4', name: '감자조림', price: 2500, description: '달콤 짭조름한 간장 감자조림입니다.', imageUrl: '' },
    { id: 'side-5', name: '멸치볶음', price: 2500, description: '고소한 멸치 볶음 반찬입니다.', imageUrl: '' },
    { id: 'side-6', name: '잡채', price: 3500, description: '당면과 각종 야채가 들어간 잡채입니다.', imageUrl: '' },
  ],
  salad: [
    { id: 'salad-1', name: '코울슬로', price: 3000, description: '상큼한 양배추 샐러드입니다.', imageUrl: '' },
    { id: 'salad-2', name: '양념감자', price: 3500, description: '매콤달콤한 양념 감자 샐러드입니다.', imageUrl: '' },
    { id: 'salad-3', name: '그린샐러드', price: 4000, description: '신선한 채소만으로 구성된 샐러드입니다.', imageUrl: '' },
    { id: 'salad-4', name: '콥샐러드', price: 4500, description: '닭가슴살, 베이컨, 아보카도가 들어간 샐러드입니다.', imageUrl: '' },
    { id: 'salad-5', name: '시저샐러드', price: 5000, description: '크루통과 파마산 치즈가 들어간 시저 샐러드입니다.', imageUrl: '' },
  ],
  beverage: [
    { id: 'beverage-1', name: '생수 500ml', price: 500, description: '개인용 생수 한 병입니다.', imageUrl: '' },
    { id: 'beverage-2', name: '생수 2L', price: 1500, description: '단체용 대용량 생수입니다.', imageUrl: '' },
    { id: 'beverage-3', name: '콜라', price: 1000, description: '시원한 탄산음료 콜라입니다.', imageUrl: '' },
    { id: 'beverage-4', name: '사이다', price: 1000, description: '시원한 탄산음료 사이다입니다.', imageUrl: '' },
    { id: 'beverage-5', name: '아이스티', price: 1500, description: '복숭아 맛 아이스티입니다.', imageUrl: '' },
    { id: 'beverage-6', name: '주스', price: 1500, description: '신선한 과일 주스입니다.', imageUrl: '' },
  ],
  dessert: [
    { id: 'dessert-1', name: '과일', price: 2000, description: '신선한 제철 과일 모음입니다.', imageUrl: '' },
    { id: 'dessert-2', name: '요거트', price: 1500, description: '부드러운 플레인 요거트입니다.', imageUrl: '' },
    { id: 'dessert-3', name: '케이크', price: 3500, description: '달콤한 미니 케이크입니다.', imageUrl: '' },
    { id: 'dessert-4', name: '쿠키', price: 1000, description: '바삭한 수제 쿠키입니다.', imageUrl: '' },
  ],
};

async function getStores() {
  const redis = getRedis();
  const raw = await redis.get(STORES_KEY);
  if (raw) {
    return typeof raw === 'string' ? JSON.parse(raw) : raw;
  }
  await seedStoresAndMenus();
  return DEFAULT_STORES;
}

async function seedStoresAndMenus() {
  const redis = getRedis();
  await redis.set(STORES_KEY, JSON.stringify(DEFAULT_STORES));
  for (const [storeId, menus] of Object.entries(DEFAULT_MENUS)) {
    await redis.set(`app:menus:${storeId}`, JSON.stringify(menus));
  }
}

async function getMenus(storeId) {
  const redis = getRedis();
  const raw = await redis.get(`app:menus:${storeId}`);
  if (raw) {
    const parsed = typeof raw === 'string' ? JSON.parse(raw) : raw;
    return Array.isArray(parsed) ? parsed.map(normalizeMenuItem) : [];
  }
  return (DEFAULT_MENUS[storeId] || []).map(normalizeMenuItem);
}

async function saveStoresAndMenus(stores, menusByStore) {
  const redis = getRedis();
  const previousStores = await getStores();
  const previousIds = new Set((previousStores || []).map((s) => s.id));
  const newIds = new Set((stores || []).map((s) => s.id));
  const removedIds = [...previousIds].filter((id) => !newIds.has(id));
  await redis.set(STORES_KEY, JSON.stringify(stores));
  for (const [storeId, menus] of Object.entries(menusByStore)) {
    const normalizedMenus = Array.isArray(menus) ? menus.map(normalizeMenuItem) : [];
    await redis.set(`app:menus:${storeId}`, JSON.stringify(normalizedMenus));
  }
  for (const storeId of removedIds) {
    await redis.del(`app:menus:${storeId}`);
  }
}

/**
 * @param {string} [userEmail] - 로그인 사용자 이메일. 있으면 관리자는 전체, 일반 사용자는 allowedEmails에 포함된 매장만 반환.
 */
async function getMenuDataForApp(userEmail) {
  let stores = await getStores();
  if (!stores || stores.length === 0) return {};
  if (userEmail && typeof userEmail === 'string') {
    if (getUserLevel(userEmail) !== 'admin') {
      const normalized = userEmail.trim().toLowerCase();
      stores = stores.filter((s) => {
        const list = (s.allowedEmails || []).map((e) =>
          e && typeof e === 'object' && e.email != null ? String(e.email).trim().toLowerCase() : String(e).trim().toLowerCase()
        ).filter(Boolean);
        return list.includes(normalized);
      });
    }
  }
  const redis = getRedis();
  const menuKeys = stores.map((s) => `app:menus:${s.id}`);
  const menusRaw = menuKeys.length ? await redis.mget(...menuKeys) : [];
  const result = {};
  for (let i = 0; i < stores.length; i++) {
    const raw = menusRaw[i];
    const items = raw
      ? typeof raw === 'string'
        ? JSON.parse(raw)
        : raw
      : DEFAULT_MENUS[stores[i].id] || [];
    const visibleItems = (Array.isArray(items) ? items : [])
      .map(normalizeMenuItem)
      .filter((item) => item.isSoldOut !== true);
    const businessDays = stores[i].businessDays && Array.isArray(stores[i].businessDays) ? stores[i].businessDays : [0, 1, 2, 3, 4, 5, 6];
    const businessHours = stores[i].businessHours && Array.isArray(stores[i].businessHours) && stores[i].businessHours.length > 0 ? stores[i].businessHours : BUSINESS_HOURS_SLOTS;
    result[stores[i].slug] = { title: stores[i].title, items: visibleItems, payment: stores[i].payment, suburl: (stores[i].suburl || ''), brand: (stores[i].brand || ''), bizNo: (stores[i].bizNo || ''), businessDays, businessHours };
  }
  return result;
}

const PROFILE_SETTINGS_KEY_PREFIX = 'profile_settings:';

async function getProfileSettings(email) {
  if (!email || typeof email !== 'string') return null;
  const redis = getRedis();
  const key = PROFILE_SETTINGS_KEY_PREFIX + email.trim().toLowerCase();
  const raw = await redis.get(key);
  if (!raw) return null;
  return typeof raw === 'string' ? JSON.parse(raw) : raw;
}

/** 여러 이메일의 프로필 설정을 한 번에 조회 (배치 최적화) */
async function getProfileSettingsBatch(emails) {
  if (!Array.isArray(emails) || emails.length === 0) return {};
  const redis = getRedis();
  const normalized = [...new Set(emails.map((e) => (e && typeof e === 'string' ? e.trim().toLowerCase() : '')).filter(Boolean))];
  if (normalized.length === 0) return {};
  const keys = normalized.map((e) => PROFILE_SETTINGS_KEY_PREFIX + e);
  const raws = await redis.mget(...keys);
  const out = {};
  normalized.forEach((email, i) => {
    const raw = raws[i];
    if (raw == null) return;
    try {
      out[email] = typeof raw === 'string' ? JSON.parse(raw) : raw;
    } catch (_) {}
  });
  return out;
}

async function setProfileSettings(email, data) {
  if (!email || typeof email !== 'string') return false;
  const redis = getRedis();
  const key = PROFILE_SETTINGS_KEY_PREFIX + email.trim().toLowerCase();
  const digits = String(data.bizNumber || '').replace(/\D/g, '').slice(0, 10);
  const bizNumberFormatted = digits.length === 10
    ? `${digits.slice(0, 3)}-${digits.slice(3, 5)}-${digits.slice(5, 10)}`
    : digits;
  const payload = {
    storeName: (data.storeName || '').trim(),
    bizNumber: bizNumberFormatted,
    name: (data.name || '').trim(),
    contact: (data.contact || '').trim().replace(/\D/g, '').slice(0, 11),
    address: (data.address || '').trim(),
    detailAddress: (data.detailAddress || '').trim(),
  };
  await redis.set(key, JSON.stringify(payload));
  return true;
}

module.exports = {
  checkRateLimitIncr,
  saveAuthCode,
  getAndDeleteAuthCode,
  getUser,
  createUser,
  updateUserLogin,
  updateUserLevel,
  addUserZeroPoints,
  deductUserZeroPoints,
  refundUserZeroPoints,
  appendZeroPointHistory,
  getZeroPointHistoryByEmail,
  migrateZeroPointGrantsFromOrdersIfNeeded,
  expireUserZeroPointsByPolicy,
  expireAllUsersZeroPointsByPolicy,
  createOrder,
  getOrdersByUser,
  getOrderById,
  saveOrder,
  deleteOrder,
  updateOrderStatus,
  updateOrderCancelReason,
  updateOrderPdfUrl,
  updateOrderPaymentLink,
  updateOrderShippingNumber,
  updateOrderParcelAndDeliveryComplete,
  updateOrderDeliveryCompleteDirect,
  updateOrderAcceptToken,
  setOrderNotificationSent,
  updateOrderTossPaymentKey,
  updateOrderUserAsOrderSent,
  getAllOrders,
  getAdminZeroPointUserRows,
  getOrdersForAdmin,
  getStores,
  getMenus,
  saveStoresAndMenus,
  getMenuDataForApp,
  getRedis,
  getProfileSettings,
  getProfileSettingsBatch,
  setProfileSettings,
  appendResendLog,
  getResendLogsForAdmin,
  normalizeResendLogRecipientEmail,
};
