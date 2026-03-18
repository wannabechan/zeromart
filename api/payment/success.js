/**
 * GET /api/payment/success
 * Toss 결제 성공 리다이렉트: 확인 후 주문 상태를 결제 완료로 변경
 */

const crypto = require('crypto');
const { getOrderById, updateOrderStatus, updateOrderTossPaymentKey, updateOrderAcceptToken } = require('../_redis');
const { getAppOrigin, getTossSecretKeyForOrder } = require('./_helpers');
const { appendOrderRawLog } = require('../_orderRawLog');

const TOSS_CONFIRM = 'https://api.tosspayments.com/v1/payments/confirm';

function pickQuery(req, key) {
  const v = req.query[key] ?? req.query[key.toLowerCase()];
  return Array.isArray(v) ? v[0] : v;
}

module.exports = async (req, res) => {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).end();
  }

  const orderId = pickQuery(req, 'orderId');
  const paymentKey = pickQuery(req, 'paymentKey');
  const amount = pickQuery(req, 'amount');

  const origin = getAppOrigin(req);
  const redirectBase = `${origin}/`;

  if (!orderId || !paymentKey || amount === undefined) {
    const missing = []; if (!orderId) missing.push('orderId'); if (!paymentKey) missing.push('paymentKey'); if (amount === undefined) missing.push('amount');
    console.error('Payment success: missing params', missing.join(', '));
    return res.redirect(302, `${redirectBase}?payment=error`);
  }

  const orderIdStr = String(orderId).trim();
  const order = await getOrderById(orderIdStr);
  if (!order) {
    console.error('Payment success: order not found', orderIdStr);
    return res.redirect(302, `${redirectBase}?payment=error`);
  }

  // 이미 결제 완료된 주문이면 재처리 없이 성공 리다이렉트 (이중 요청/새로고침 대비)
  if ((order.status || '') === 'payment_completed') {
    return res.redirect(302, `${redirectBase}?payment=success`);
  }

  const TOSS_SECRET_KEY = await getTossSecretKeyForOrder(order);
  if (!TOSS_SECRET_KEY) {
    return res.redirect(302, `${redirectBase}?payment=error`);
  }

  try {
    const amountNum = Number(amount);
    const auth = Buffer.from(`${TOSS_SECRET_KEY}:`, 'utf8').toString('base64');
    const confirmRes = await fetch(TOSS_CONFIRM, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Basic ${auth}`,
      },
      body: JSON.stringify({
        paymentKey: String(paymentKey).trim(),
        orderId: orderIdStr,
        amount: amountNum,
      }),
    });

    if (!confirmRes.ok) {
      const errBody = await confirmRes.text();
      console.error('Payment success: confirm failed', confirmRes.status, errBody);
      return res.redirect(302, `${redirectBase}?payment=error`);
    }

    await updateOrderTossPaymentKey(orderIdStr, String(paymentKey).trim());
    await updateOrderStatus(orderIdStr, 'payment_completed');

    appendOrderRawLog(order, {
      eventType: 'payment_completed',
      statusAfter: 'payment_completed',
      actor: 'payment',
      note: '결제 완료',
    }).catch((e) => console.error('[orderRawLog]', e.message));

    // 주문서 PDF 링크용 토큰만 설정. 매장 담당자 메일은 결제 완료 45분 후 cron에서 발송
    const pdfToken = crypto.randomBytes(24).toString('hex');
    await updateOrderAcceptToken(orderIdStr, pdfToken);

    return res.redirect(302, `${redirectBase}?payment=success`);
  } catch (err) {
    console.error('Payment success handler error:', err);
    return res.redirect(302, `${redirectBase}?payment=error`);
  }
};
