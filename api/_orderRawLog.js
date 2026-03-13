/**
 * 주문 이벤트 원시 로그 (마스킹 적용, Redis 버퍼 후 저장)
 * - 저장 제외: 카드번호·CVC·비밀번호·토큰·API키·주민번호 등
 * - 이메일: 앞 2자+@도메인
 * - 연락처: 뒤 4자리만
 * - 주소: 상세주소 제외
 * - 수령인/주문자 이름: 성(1글자)+이름 마지막 1자 (예: 김*수, 남**민)
 */

const { getRedis } = require('./_redis');
const { getTodayKSTDateKey } = require('./_kst');

const CSV_HEADER =
  'event_ts,event_type,order_id,status_after,user_email_masked,depositor_masked,contact_masked,delivery_address_masked,total_amount,cancel_reason,actor,note';

/** CSV 필드 이스케이프 (쉼표/줄바꿈/따옴표 포함 시) */
function csvEscape(val) {
  if (val == null) return '';
  const s = String(val).trim();
  if (s.includes(',') || s.includes('"') || s.includes('\n') || s.includes('\r')) {
    return '"' + s.replace(/"/g, '""') + '"';
  }
  return s;
}

/** 현재 시점 KST ISO 문자열 (예: 2026-03-12T09:15:32+09:00) */
function nowKSTISO() {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  const y = d.getFullYear();
  const m = pad(d.getMonth() + 1);
  const day = pad(d.getDate());
  const h = pad(d.getHours());
  const min = pad(d.getMinutes());
  const sec = pad(d.getSeconds());
  return `${y}-${m}-${day}T${h}:${min}:${sec}+09:00`;
}

/** 이메일: 앞 2자+@도메인 */
function maskEmail(email) {
  if (!email || typeof email !== 'string') return '';
  const trimmed = email.trim().toLowerCase();
  const at = trimmed.indexOf('@');
  if (at <= 0) return '***@***';
  const local = trimmed.slice(0, at);
  const domain = trimmed.slice(at);
  const head = local.slice(0, 2);
  return head + '***' + domain;
}

/** 연락처: 뒤 4자리만 (숫자만 추출 후) */
function maskContact(contact) {
  if (contact == null || contact === '') return '';
  const digits = String(contact).replace(/\D/g, '');
  if (digits.length < 4) return digits;
  return digits.slice(-4);
}

/** 수령인/주문자 이름: 성(1글자)+이름 마지막 1자. 예: 김*수, 남**민 */
function maskDepositor(name) {
  if (!name || typeof name !== 'string') return '';
  const trimmed = name.trim();
  if (!trimmed) return '';
  const chars = [...trimmed];
  if (chars.length <= 2) return chars[0] + (chars[1] || '*');
  return chars[0] + '*'.repeat(chars.length - 2) + chars[chars.length - 1];
}

/** 주소: 상세주소만 제외 (기본 도로명/지번 등만 유지). detail_address는 별도 필드로 넘기지 않음. */
function maskAddress(fullAddress, detailAddress) {
  if (!fullAddress || typeof fullAddress !== 'string') return '';
  let addr = fullAddress.trim();
  if (detailAddress && typeof detailAddress === 'string') {
    const detail = detailAddress.trim();
    if (detail && addr.endsWith(detail)) addr = addr.slice(0, -detail.length).trim();
  }
  return addr;
}

/**
 * 주문 객체와 이벤트 정보로 마스킹된 CSV 한 줄 생성 후 Redis 리스트에 추가.
 * 키: order_raw_log:YYYY-MM-DD (일별 버퍼). 추후 cron 등에서 Blob/파일로 flush.
 *
 * @param {object} order - { id, user_email, depositor, contact, delivery_address, detail_address, total_amount, status, ... }
 * @param {object} opts - { eventType, statusAfter, actor, note, cancelReason? }
 */
async function appendOrderRawLog(order, opts) {
  if (!order || !opts || !opts.eventType) return;

  const eventTs = nowKSTISO();
  const eventType = csvEscape(opts.eventType);
  const orderId = csvEscape(order.id);
  const statusAfter = csvEscape(opts.statusAfter != null ? opts.statusAfter : order.status);
  const userEmailMasked = csvEscape(maskEmail(order.user_email));
  const depositorMasked = csvEscape(maskDepositor(order.depositor));
  const contactMasked = csvEscape(maskContact(order.contact));
  const deliveryAddressMasked = csvEscape(maskAddress(order.delivery_address, order.detail_address));
  const totalAmount = order.total_amount != null ? Number(order.total_amount) : 0;
  const cancelReason = csvEscape(opts.cancelReason || '');
  const actor = csvEscape(opts.actor || 'system');
  const note = csvEscape(opts.note || '');

  const line = [eventTs, eventType, orderId, statusAfter, userEmailMasked, depositorMasked, contactMasked, deliveryAddressMasked, totalAmount, cancelReason, actor, note].join(',');

  try {
    const redis = getRedis();
    const dateKey = getTodayKSTDateKey();
    const key = `order_raw_log:${dateKey}`;
    await redis.rpush(key, line);
  } catch (e) {
    console.error('[orderRawLog] append failed:', e.message);
  }
}

/**
 * 일별 버퍼(Redis 리스트)를 CSV 본문으로 반환. (헤더 + 해당일 모든 라인)
 * @param {string} dateKey - YYYY-MM-DD
 * @returns {Promise<string>} CSV 전체 문자열
 */
async function flushOrderRawLogToCsv(dateKey) {
  const redis = getRedis();
  const key = `order_raw_log:${dateKey}`;
  const lines = await redis.lrange(key, 0, -1);
  await redis.del(key);
  if (!lines || lines.length === 0) return CSV_HEADER + '\n';
  return CSV_HEADER + '\n' + lines.join('\n') + '\n';
}

module.exports = {
  maskEmail,
  maskContact,
  maskDepositor,
  maskAddress,
  appendOrderRawLog,
  flushOrderRawLogToCsv,
  CSV_HEADER,
  nowKSTISO,
};
