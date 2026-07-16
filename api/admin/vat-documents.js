/**
 * GET /api/admin/vat-documents?startMonth=YYYY-MM&endMonth=YYYY-MM&group=
 * 어드민 자료관리: 월별 부가세 참고 자료 집계
 */

const { verifyToken, apiResponse } = require('../_utils');
const { getOrdersForAdmin, getStores, getMenus, saveOrder } = require('../_redis');
const { getTossSecretKeyForOrder } = require('../payment/_helpers');
const {
  buildVatPaymentSnapshotFromToss,
  contributeOrderToMonthMap,
  listMonthsInclusive,
  emptyMonthRow,
} = require('../payment/_vatPayment');

const TOSS_PAYMENT_GET = 'https://api.tosspayments.com/v1/payments';
const BACKFILL_CONCURRENCY = 4;
const BACKFILL_MAX = 80;

function isPaidStatus(status) {
  const s = (status || '').trim();
  return (
    s === 'payment_completed' ||
    s === 'shipping' ||
    s === 'delivery_completed' ||
    s === 'cancelled'
  );
}

function needsVatBackfill(order) {
  if (!isPaidStatus(order.status)) return false;
  const key = (order.toss_payment_key || order.payment_key || '').toString().trim();
  if (!key) return false;
  if (order.status === 'cancelled' && !(order.cancel_reason === '결제취소')) {
    // 결제 전 취소 등은 스냅샷 불필요
    if (!order.payment_completed_at && !order.vat_payment) return false;
  }
  if (!order.vat_payment || !order.vat_payment.buckets) return true;
  if (order.status === 'cancelled' && order.cancel_reason === '결제취소') {
    const cancels = order.vat_payment.cancels;
    if (!Array.isArray(cancels) || cancels.length === 0) return true;
  }
  return false;
}

async function fetchTossPayment(paymentKey, secretKey) {
  const auth = Buffer.from(`${secretKey}:`, 'utf8').toString('base64');
  const res = await fetch(`${TOSS_PAYMENT_GET}/${encodeURIComponent(paymentKey)}`, {
    method: 'GET',
    headers: { Authorization: `Basic ${auth}` },
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const msg = data.message || data.error?.message || `Toss payment fetch ${res.status}`;
    throw new Error(typeof msg === 'string' ? msg : 'Toss payment fetch failed');
  }
  return data;
}

async function mapPool(items, concurrency, fn) {
  const results = new Array(items.length);
  let idx = 0;
  async function worker() {
    while (idx < items.length) {
      const i = idx;
      idx += 1;
      results[i] = await fn(items[i], i);
    }
  }
  const n = Math.min(concurrency, Math.max(1, items.length));
  await Promise.all(Array.from({ length: n }, () => worker()));
  return results;
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

    const startMonth = String(req.query.startMonth || '').trim();
    const endMonth = String(req.query.endMonth || '').trim();
    const group = String(req.query.group || '').trim();

    if (!/^\d{4}-\d{2}$/.test(startMonth) || !/^\d{4}-\d{2}$/.test(endMonth)) {
      return apiResponse(res, 400, { error: 'startMonth·endMonth (YYYY-MM)가 필요합니다.' });
    }
    if (startMonth > endMonth) {
      return apiResponse(res, 400, { error: '시작월은 끝월 이전이어야 합니다.' });
    }

    let orders = (await getOrdersForAdmin()) || [];
    const baseStores = (await getStores()) || [];
    const stores = await Promise.all(
      baseStores.map(async (s) => {
        const sid = s.id || s.slug;
        let items = [];
        try {
          items = (await getMenus(sid)) || [];
        } catch (_) {
          items = [];
        }
        return { ...s, items };
      })
    );

    const candidates = orders.filter((o) => needsVatBackfill(o));
    const toBackfill = candidates.slice(0, BACKFILL_MAX);
    let backfillOk = 0;
    let backfillFail = 0;

    if (toBackfill.length > 0) {
      await mapPool(toBackfill, BACKFILL_CONCURRENCY, async (order) => {
        try {
          const secret = await getTossSecretKeyForOrder(order);
          if (!secret) {
            backfillFail += 1;
            return;
          }
          const paymentKey = String(order.toss_payment_key || order.payment_key || '').trim();
          const payment = await fetchTossPayment(paymentKey, secret);
          const snap = buildVatPaymentSnapshotFromToss(payment);
          order.vat_payment = snap;
          if (!order.payment_completed_at && snap.approvedAt) {
            order.payment_completed_at = snap.approvedAt;
          }
          await saveOrder(order);
          backfillOk += 1;
        } catch (e) {
          backfillFail += 1;
          console.error('vat-documents backfill', order.id, e.message);
        }
      });
      // refresh list after saves (in-memory objects already updated)
    }

    const monthMap = {};
    const months = listMonthsInclusive(startMonth, endMonth);
    months.forEach((m) => {
      monthMap[m] = emptyMonthRow(m.replace('-', '.'));
    });

    for (const order of orders) {
      if (!order.vat_payment || !order.vat_payment.buckets) continue;
      // 결제 전 취소만 있는 건 제외
      if (order.status === 'cancelled' && !order.payment_completed_at && !order.vat_payment.approvedAt) {
        continue;
      }
      try {
        contributeOrderToMonthMap(monthMap, order, stores, group, startMonth, endMonth);
      } catch (e) {
        console.error('vat-documents contribute', order.id, e.message);
      }
    }

    const rows = months.map((m) => {
      const r = monthMap[m] || emptyMonthRow(m.replace('-', '.'));
      return {
        period: r.period,
        taxable: r.taxable,
        nontaxable: r.nontaxable,
        card: r.card,
        cashIncome: r.cashIncome,
        cashExpense: r.cashExpense,
        cashExcluded: r.cashExcluded,
        other: r.other,
      };
    });

    return apiResponse(res, 200, {
      startMonth,
      endMonth,
      group: group || '',
      rows,
      meta: {
        backfillAttempted: toBackfill.length,
        backfillOk,
        backfillFail,
        backfillPending: Math.max(0, candidates.length - toBackfill.length),
        disclaimer: '세무신고용 아님 · 내부 참고용',
      },
    });
  } catch (error) {
    console.error('Admin vat-documents error:', error);
    return apiResponse(res, 500, { error: '서버 오류가 발생했습니다.' });
  }
};
