/**
 * 제로마트 부가세(자료관리)용 결제·과세 스냅샷 / 분류 유틸
 */

const { getOrderItemStoreKey } = require('../orders/_order-email');
const { toKSTDateKey } = require('../_kst');

function floorNonNeg(n) {
  const v = Math.floor(Number(n));
  if (!Number.isFinite(v) || v < 0) return 0;
  return v;
}

function emptyBuckets() {
  return { d: 0, e: 0, f: 0, g: 0, h: 0 };
}

function sumBuckets(b) {
  if (!b) return 0;
  return floorNonNeg(b.d) + floorNonNeg(b.e) + floorNonNeg(b.f) + floorNonNeg(b.g) + floorNonNeg(b.h);
}

function scaleBuckets(buckets, numerator, denominator) {
  const out = emptyBuckets();
  if (!buckets || denominator <= 0 || numerator <= 0) return out;
  if (numerator >= denominator) {
    return {
      d: floorNonNeg(buckets.d),
      e: floorNonNeg(buckets.e),
      f: floorNonNeg(buckets.f),
      g: floorNonNeg(buckets.g),
      h: floorNonNeg(buckets.h),
    };
  }
  const keys = ['d', 'e', 'f', 'g', 'h'];
  const raw = keys.map((k) => (floorNonNeg(buckets[k]) * numerator) / denominator);
  const floored = raw.map((x) => Math.floor(x));
  const targetSum = Math.floor((sumBuckets(buckets) * numerator) / denominator);
  let remain = targetSum - floored.reduce((a, b) => a + b, 0);
  const order = raw
    .map((x, i) => ({ i, frac: x - Math.floor(x) }))
    .sort((a, b) => b.frac - a.frac);
  for (let n = 0; n < order.length && remain > 0; n++) {
    floored[order[n].i] += 1;
    remain -= 1;
  }
  keys.forEach((k, i) => {
    out[k] = floored[i];
  });
  return out;
}

function negateBuckets(buckets) {
  return {
    d: -floorNonNeg(buckets?.d),
    e: -floorNonNeg(buckets?.e),
    f: -floorNonNeg(buckets?.f),
    g: -floorNonNeg(buckets?.g),
    h: -floorNonNeg(buckets?.h),
  };
}

/**
 * 총액 배열에 대해 할인액(ZP)을 금액 비율로 차감한 순액 배열 (원 단위, 합=총액-할인).
 */
function allocateProportionalNets(grossAmounts, discountTotal) {
  const gross = (grossAmounts || []).map((g) => floorNonNeg(g));
  const totalGross = gross.reduce((a, b) => a + b, 0);
  const discount = Math.min(floorNonNeg(discountTotal), totalGross);
  if (totalGross <= 0) return gross.map(() => 0);
  if (discount <= 0) return gross.slice();

  const rawDisc = gross.map((g) => (g * discount) / totalGross);
  const discFloor = rawDisc.map((x) => Math.floor(x));
  let remain = discount - discFloor.reduce((a, b) => a + b, 0);
  const order = rawDisc
    .map((x, i) => ({ i, frac: x - Math.floor(x) }))
    .sort((a, b) => b.frac - a.frac);
  for (let n = 0; n < order.length && remain > 0; n++) {
    discFloor[order[n].i] += 1;
    remain -= 1;
  }
  return gross.map((g, i) => Math.max(0, g - discFloor[i]));
}

function normalizeTaxType(v) {
  return v === 'nontaxable' ? 'nontaxable' : 'taxable';
}

/** 매장 메뉴 id → taxType 맵 */
function buildMenuTaxTypeMap(stores) {
  const map = new Map();
  for (const store of stores || []) {
    const items = store.items || store.menuItems || [];
    if (!Array.isArray(items)) continue;
    for (const item of items) {
      if (!item || item.id == null) continue;
      map.set(String(item.id), normalizeTaxType(item.taxType));
    }
  }
  return map;
}

function resolveItemTaxType(item, menuTaxMap) {
  if (item && (item.taxType === 'nontaxable' || item.taxType === 'taxable')) {
    return item.taxType;
  }
  const id = item && item.id != null ? String(item.id) : '';
  if (id && menuTaxMap && menuTaxMap.has(id)) return menuTaxMap.get(id);
  return 'taxable';
}

/**
 * 주문 라인 순액(과세/면세) + 브랜드(suburl) 필터용 라인 정보
 */
function buildOrderTaxLines(order, stores) {
  const menuTaxMap = buildMenuTaxTypeMap(stores);
  const storeBySlug = new Map();
  for (const s of stores || []) {
    const slug = (s.slug || s.id || '').toString().toLowerCase();
    if (slug) storeBySlug.set(slug, s);
  }
  const items = order.order_items || order.orderItems || [];
  const lines = [];
  for (const it of Array.isArray(items) ? items : []) {
    if (!it) continue;
    const qty = floorNonNeg(it.quantity);
    const price = floorNonNeg(it.price);
    const gross = qty * price;
    if (gross <= 0) continue;
    const slug = getOrderItemStoreKey(it.id);
    const store = storeBySlug.get(slug);
    const suburl = store ? (store.suburl || '').toString().trim() : '';
    lines.push({
      id: it.id,
      slug,
      suburl,
      gross,
      taxType: resolveItemTaxType(it, menuTaxMap),
    });
  }
  const nets = allocateProportionalNets(
    lines.map((l) => l.gross),
    Math.floor(Number(order.zero_point_used) || 0)
  );
  return lines.map((l, i) => ({ ...l, net: nets[i] }));
}

function sumTaxSalesForLines(lines, suburlFilter) {
  let taxable = 0;
  let nontaxable = 0;
  let groupNet = 0;
  let allNet = 0;
  for (const l of lines || []) {
    allNet += floorNonNeg(l.net);
    if (suburlFilter && l.suburl !== suburlFilter) continue;
    groupNet += floorNonNeg(l.net);
    if (l.taxType === 'nontaxable') nontaxable += floorNonNeg(l.net);
    else taxable += floorNonNeg(l.net);
  }
  return { taxable, nontaxable, groupNet, allNet };
}

/**
 * 토스 Payment 객체 → D~H 버킷 + 메타
 */
function classifyTossPaymentBuckets(payment) {
  const buckets = emptyBuckets();
  if (!payment || typeof payment !== 'object') {
    return { buckets, meta: {} };
  }

  const totalAmount = floorNonNeg(payment.totalAmount);
  const card = payment.card && typeof payment.card === 'object' ? payment.card : null;
  const easyPay = payment.easyPay && typeof payment.easyPay === 'object' ? payment.easyPay : null;
  let cardAmount = card ? floorNonNeg(card.amount) : 0;
  let easyAmount = easyPay ? floorNonNeg(easyPay.amount) : 0;
  let discountAmount = easyPay ? floorNonNeg(easyPay.discountAmount) : 0;

  const cashReceipt = payment.cashReceipt && typeof payment.cashReceipt === 'object' ? payment.cashReceipt : null;
  let crType = cashReceipt && cashReceipt.type != null ? String(cashReceipt.type).trim() : '';
  if (crType === '미발행') crType = '';

  if (cardAmount + easyAmount + discountAmount === 0 && totalAmount > 0) {
    const method = String(payment.method || '').trim();
    const methodUpper = method.toUpperCase();
    if (method === '카드' || methodUpper === 'CARD' || method === '간편결제' || methodUpper === 'EASY_PAY') {
      cardAmount = totalAmount;
    } else {
      discountAmount = totalAmount;
    }
  }

  buckets.d += cardAmount;
  buckets.h += discountAmount;

  if (easyAmount > 0) {
    if (crType === '소득공제') buckets.e += easyAmount;
    else if (crType === '지출증빙') buckets.f += easyAmount;
    else buckets.g += easyAmount;
  }

  const meta = {
    approvedAt: payment.approvedAt || null,
    totalAmount,
    method: payment.method || null,
    cardAmount,
    easyPayAmount: easyAmount,
    easyPayDiscountAmount: discountAmount,
    cashReceiptType: crType || null,
    provider: easyPay && easyPay.provider != null ? String(easyPay.provider) : null,
  };

  return { buckets, meta };
}

/**
 * 취소 1건(cancels[] 요소 또는 cancel API 응답의 최신 cancel) → 버킷
 * 원결제 버킷이 있으면 취소액 비율로 안분, 없으면 전액 G(또는 H) 추정 최소화 위해 원결제 메타 사용
 */
function classifyCancelBuckets(cancelEntry, originalBuckets, originalTotal) {
  const cancelAmount = floorNonNeg(
    cancelEntry && (cancelEntry.cancelAmount != null ? cancelEntry.cancelAmount : cancelEntry.amount)
  );
  if (cancelAmount <= 0) return emptyBuckets();
  const origSum = sumBuckets(originalBuckets);
  const denom = origSum > 0 ? origSum : floorNonNeg(originalTotal);
  if (denom > 0 && originalBuckets) {
    return scaleBuckets(originalBuckets, cancelAmount, denom);
  }
  return { ...emptyBuckets(), g: cancelAmount };
}

function buildVatPaymentSnapshotFromToss(payment) {
  const { buckets, meta } = classifyTossPaymentBuckets(payment);
  const cancels = Array.isArray(payment.cancels) ? payment.cancels : [];
  const cancelSnaps = cancels
    .filter((c) => c && (c.cancelStatus == null || c.cancelStatus === 'DONE'))
    .map((c) => {
      const cancelBuckets = classifyCancelBuckets(c, buckets, meta.totalAmount);
      return {
        canceledAt: c.canceledAt || null,
        cancelAmount: floorNonNeg(c.cancelAmount),
        buckets: cancelBuckets,
      };
    });

  return {
    version: 1,
    fetchedAt: new Date().toISOString(),
    approvedAt: meta.approvedAt,
    totalAmount: meta.totalAmount,
    method: meta.method,
    cardAmount: meta.cardAmount,
    easyPayAmount: meta.easyPayAmount,
    easyPayDiscountAmount: meta.easyPayDiscountAmount,
    cashReceiptType: meta.cashReceiptType,
    provider: meta.provider,
    buckets,
    cancels: cancelSnaps,
  };
}

function monthKeyFromIso(iso) {
  const day = toKSTDateKey(iso);
  return day && day.length >= 7 ? day.slice(0, 7) : '';
}

function isMonthInRange(monthKey, startMonth, endMonth) {
  if (!monthKey || !/^\d{4}-\d{2}$/.test(monthKey)) return false;
  if (startMonth && monthKey < startMonth) return false;
  if (endMonth && monthKey > endMonth) return false;
  return true;
}

function emptyMonthRow(periodLabel) {
  return {
    period: periodLabel,
    taxable: 0,
    nontaxable: 0,
    card: 0,
    cashIncome: 0,
    cashExpense: 0,
    cashExcluded: 0,
    other: 0,
  };
}

function addBucketsToRow(row, buckets, sign) {
  const s = sign < 0 ? -1 : 1;
  row.card += s * floorNonNeg(buckets.d);
  row.cashIncome += s * floorNonNeg(buckets.e);
  row.cashExpense += s * floorNonNeg(buckets.f);
  row.cashExcluded += s * floorNonNeg(buckets.g);
  row.other += s * floorNonNeg(buckets.h);
}

/**
 * 저장된 vat_payment 스냅샷 + 주문 라인으로 월별 행에 가산
 */
function contributeOrderToMonthMap(monthMap, order, stores, suburlFilter, startMonth, endMonth) {
  const snap = order.vat_payment;
  if (!snap || !snap.buckets) return;

  const lines = buildOrderTaxLines(order, stores);
  const tax = sumTaxSalesForLines(lines, suburlFilter || '');
  // suburlFilter 빈 문자열 = 전체
  const filterActive = Boolean(suburlFilter);
  const allNet = tax.allNet;
  const groupNet = filterActive ? tax.groupNet : allNet;
  if (filterActive && groupNet <= 0) return;

  const shareNum = groupNet;
  const shareDen = allNet > 0 ? allNet : 0;

  const approvedAt = snap.approvedAt || order.payment_completed_at || order.created_at;
  const payMonth = monthKeyFromIso(approvedAt);
  if (isMonthInRange(payMonth, startMonth, endMonth)) {
    if (!monthMap[payMonth]) monthMap[payMonth] = emptyMonthRow(payMonth.replace('-', '.'));
    const row = monthMap[payMonth];
    if (filterActive) {
      row.taxable += tax.taxable;
      row.nontaxable += tax.nontaxable;
      const scaled = scaleBuckets(snap.buckets, shareNum, shareDen);
      addBucketsToRow(row, scaled, 1);
    } else {
      row.taxable += tax.taxable;
      row.nontaxable += tax.nontaxable;
      addBucketsToRow(row, snap.buckets, 1);
    }
  }

  const cancelList = Array.isArray(snap.cancels) ? snap.cancels : [];
  for (const c of cancelList) {
    const cancelMonth = monthKeyFromIso(c.canceledAt || order.cancelled_at);
    if (!isMonthInRange(cancelMonth, startMonth, endMonth)) continue;
    if (!monthMap[cancelMonth]) monthMap[cancelMonth] = emptyMonthRow(cancelMonth.replace('-', '.'));
    const row = monthMap[cancelMonth];
    const cancelBuckets = c.buckets || emptyBuckets();
    const cancelAmt = sumBuckets(cancelBuckets) || floorNonNeg(c.cancelAmount);
    // B/C 취소: 원 과세/면세 비율로 안분 후 브랜드 셰어
    const origTaxable = filterActive ? tax.taxable : tax.taxable;
    const origNontax = filterActive ? tax.nontaxable : tax.nontaxable;
    const origSales = origTaxable + origNontax;
    const payTotal = floorNonNeg(snap.totalAmount) || allNet;
    let cancelSales = cancelAmt;
    if (filterActive && shareDen > 0) {
      cancelSales = Math.floor((cancelAmt * shareNum) / shareDen);
    }
    if (origSales > 0 && cancelSales > 0) {
      const tPart = Math.floor((origTaxable * cancelSales) / origSales);
      const nPart = cancelSales - tPart;
      row.taxable -= tPart;
      row.nontaxable -= nPart;
    }
    if (filterActive && shareDen > 0) {
      addBucketsToRow(row, scaleBuckets(cancelBuckets, shareNum, shareDen), -1);
    } else {
      addBucketsToRow(row, cancelBuckets, -1);
    }
  }
}

function listMonthsInclusive(startMonth, endMonth) {
  const out = [];
  if (!/^\d{4}-\d{2}$/.test(startMonth) || !/^\d{4}-\d{2}$/.test(endMonth)) return out;
  let [y, m] = startMonth.split('-').map(Number);
  const [ey, em] = endMonth.split('-').map(Number);
  while (y < ey || (y === ey && m <= em)) {
    out.push(`${y}-${String(m).padStart(2, '0')}`);
    m += 1;
    if (m > 12) {
      m = 1;
      y += 1;
    }
  }
  return out;
}

module.exports = {
  emptyBuckets,
  sumBuckets,
  scaleBuckets,
  negateBuckets,
  allocateProportionalNets,
  normalizeTaxType,
  buildMenuTaxTypeMap,
  resolveItemTaxType,
  buildOrderTaxLines,
  sumTaxSalesForLines,
  classifyTossPaymentBuckets,
  classifyCancelBuckets,
  buildVatPaymentSnapshotFromToss,
  monthKeyFromIso,
  isMonthInRange,
  emptyMonthRow,
  contributeOrderToMonthMap,
  listMonthsInclusive,
  floorNonNeg,
};
