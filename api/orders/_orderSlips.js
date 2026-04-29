/**
 * 복수 매장(슬립)별 발송·배송 정보. 주문 전체 status는 전 슬립 발송 완료일 때만 delivery_completed.
 */

const { getStoresWithItemsInOrder } = require('./_order-email');
const { getOrderById, saveOrder } = require('../_redis');

const PAYMENT_CANCEL_WINDOW_MS = 45 * 60 * 1000;

const SLIP_PENDING = 'pending';
const SLIP_DONE = 'delivery_completed';

/**
 * 결제 완료 후 고객 전액 취소 가능 창 (UI와 동일 기준)
 */
function isWithinPaymentCancelWindow(order) {
  const at = order.payment_completed_at || order.paymentCompletedAt;
  if (!at) return false;
  const ts = new Date(at).getTime();
  if (Number.isNaN(ts)) return false;
  return Date.now() - ts < PAYMENT_CANCEL_WINDOW_MS;
}

function entriesAlignedSlips(order, stores) {
  const entries = getStoresWithItemsInOrder(order, stores);
  return entries.map((e, idx) => ({
    slug: e.slug,
    slipIndex: idx + 1,
    delivery_status: SLIP_PENDING,
    courier_company: null,
    tracking_number: null,
    delivery_type: null,
  }));
}

/**
 * 레거시 주문(슬립 필드 없음) 또는 불일치 시 슬립 배열 생성
 */
function buildSlipsFromOrderLegacy(order, stores) {
  const entries = getStoresWithItemsInOrder(order, stores);
  if (entries.length === 0) return [];

  const existing = Array.isArray(order.order_slips) ? order.order_slips : null;
  if (
    existing &&
    existing.length === entries.length &&
    entries.every((e, i) => (existing[i]?.slug || '') === e.slug)
  ) {
    return existing.map((s, i) => ({
      slug: entries[i].slug,
      slipIndex: i + 1,
      delivery_status: s.delivery_status === SLIP_DONE ? SLIP_DONE : SLIP_PENDING,
      courier_company: s.courier_company != null ? String(s.courier_company).trim() || null : null,
      tracking_number: s.tracking_number != null ? String(s.tracking_number).trim() || null : null,
      delivery_type: s.delivery_type === 'direct' || s.delivery_type === 'parcel' ? s.delivery_type : null,
    }));
  }

  const slips = entriesAlignedSlips(order, stores);
  const st = (order.status || '').trim();
  if (st === 'delivery_completed') {
    const cc = order.courier_company != null ? String(order.courier_company).trim() || null : null;
    const tn = order.tracking_number != null ? String(order.tracking_number).trim() || null : null;
    const dt = order.delivery_type === 'direct' || order.delivery_type === 'parcel' ? order.delivery_type : null;
    const inferred = dt || (tn ? 'parcel' : 'direct');
    for (const s of slips) {
      s.delivery_status = SLIP_DONE;
      s.courier_company = cc;
      s.tracking_number = tn;
      s.delivery_type = inferred;
    }
  }
  return slips;
}

function allSlipsDelivered(slips) {
  if (!Array.isArray(slips) || slips.length === 0) return false;
  return slips.every((s) => s.delivery_status === SLIP_DONE);
}

function anySlipDelivered(slips) {
  if (!Array.isArray(slips)) return false;
  return slips.some((s) => s.delivery_status === SLIP_DONE);
}

/** 주문 루트 필드(레거시 호환): 전 슬립 완료 시에만 채움 */
function syncRootDeliveryFromSlips(order, slips) {
  if (allSlipsDelivered(slips)) {
    // fall through to fill below
  } else {
    const allPending = slips.every((s) => s.delivery_status === SLIP_PENDING);
    if ((order.status || '') === 'shipping' && allPending) {
      return;
    }
    order.courier_company = null;
    order.tracking_number = null;
    order.delivery_type = null;
    return;
  }
  const firstParcel = slips.find((s) => s.delivery_type === 'parcel' && (s.tracking_number || s.courier_company));
  if (firstParcel) {
    order.courier_company = firstParcel.courier_company || null;
    order.tracking_number = firstParcel.tracking_number || null;
    order.delivery_type = 'parcel';
    return;
  }
  const anyDirect = slips.some((s) => s.delivery_type === 'direct');
  order.courier_company = null;
  order.tracking_number = null;
  order.delivery_type = anyDirect ? 'direct' : null;
}

/**
 * 응답·화면용: 주문에 order_slips 보장(비파괴 복사)
 */
function withHydratedSlips(order, stores) {
  if (!order || typeof order !== 'object') return order;
  const o = { ...order };
  o.order_slips = buildSlipsFromOrderLegacy(o, stores);
  return o;
}

function hydrateOrdersList(orders, stores) {
  if (!Array.isArray(orders)) return [];
  return orders.map((o) => withHydratedSlips(o, stores));
}

/**
 * Redis에 슬립이 없거나 품목과 불일치하면 저장까지 반영
 */
async function persistSlipsIfMissing(orderId, stores) {
  const order = await getOrderById(orderId);
  if (!order) return null;
  const entries = getStoresWithItemsInOrder(order, stores);
  if (entries.length === 0) return order;

  const slips = buildSlipsFromOrderLegacy(order, stores);
  const same =
    Array.isArray(order.order_slips) &&
    order.order_slips.length === slips.length &&
    slips.every((s, i) => {
      const o = order.order_slips[i];
      return o && o.slug === s.slug && o.delivery_status === s.delivery_status &&
        (o.courier_company || '') === (s.courier_company || '') &&
        (o.tracking_number || '') === (s.tracking_number || '') &&
        (o.delivery_type || '') === (s.delivery_type || '');
    });
  if (same) return order;

  order.order_slips = slips;
  syncRootDeliveryFromSlips(order, slips);
  await saveOrder(order);
  return order;
}

function findManagerSlipIndex(order, stores, managerEmail) {
  const entries = getStoresWithItemsInOrder(order, stores);
  const em = (managerEmail || '').trim().toLowerCase();
  for (let i = 0; i < entries.length; i++) {
    const mail = (entries[i].store?.storeContactEmail || '').trim().toLowerCase();
    if (mail && mail === em) return i;
  }
  return -1;
}

/**
 * 슬립 한 건 발송 완료 반영 후 저장. 전 슬립 완료 시 주문 status = delivery_completed.
 */
async function applySlipDeliveryComplete(orderId, stores, slipIndex, payload) {
  const order = await persistSlipsIfMissing(orderId, stores);
  if (!order) return { ok: false, error: '주문을 찾을 수 없습니다.' };
  const slips = order.order_slips;
  if (!Array.isArray(slips) || slipIndex < 0 || slipIndex >= slips.length) {
    return { ok: false, error: '유효하지 않은 주문서(슬립)입니다.' };
  }
  const cur = slips[slipIndex];
  if (cur.delivery_status === SLIP_DONE) {
    return { ok: false, error: '이미 발송 완료 처리된 주문서입니다.' };
  }

  const { courierCompany, trackingNumber, deliveryType } = payload;
  if (deliveryType === 'parcel') {
    slips[slipIndex] = {
      ...cur,
      delivery_status: SLIP_DONE,
      delivery_type: 'parcel',
      courier_company: (courierCompany || '').trim() || null,
      tracking_number: (trackingNumber || '').trim() || null,
    };
  } else {
    slips[slipIndex] = {
      ...cur,
      delivery_status: SLIP_DONE,
      delivery_type: 'direct',
      courier_company: null,
      tracking_number: null,
    };
  }

  syncRootDeliveryFromSlips(order, slips);
  if (allSlipsDelivered(slips)) {
    order.status = 'delivery_completed';
  } else if ((order.status || '') === 'delivery_completed') {
    order.status = 'payment_completed';
  }

  await saveOrder(order);
  return { ok: true, order };
}

/** 슬립별 배송 표시 줄 (접두사 없이 내용만) */
function slipDeliveryBodyLine(slip, orderId) {
  const id = String(orderId || '');
  const num = slip.slipIndex || 1;
  if (slip.delivery_status !== SLIP_DONE) return `#${id}-${num}: 미입력`;
  if (slip.delivery_type === 'direct') return `#${id}-${num}: 직접 배송 완료`;
  const cc = (slip.courier_company || '').trim();
  const tn = (slip.tracking_number || '').trim();
  if (cc || tn) return `#${id}-${num}: ${cc || '—'} / ${tn}`;
  return `#${id}-${num}: 미입력`;
}

function slipDeliveryLinesForDisplay(order, stores) {
  const o = withHydratedSlips(order, stores);
  const slips = o.order_slips || [];
  return slips.map((s) => slipDeliveryBodyLine(s, o.id));
}

module.exports = {
  PAYMENT_CANCEL_WINDOW_MS,
  SLIP_PENDING,
  SLIP_DONE,
  isWithinPaymentCancelWindow,
  buildSlipsFromOrderLegacy,
  allSlipsDelivered,
  anySlipDelivered,
  withHydratedSlips,
  hydrateOrdersList,
  persistSlipsIfMissing,
  findManagerSlipIndex,
  applySlipDeliveryComplete,
  slipDeliveryLinesForDisplay,
  syncRootDeliveryFromSlips,
};
