/**
 * GET /api/payment/success
 * Toss 결제 성공 리다이렉트: 확인 후 주문 상태를 결제 완료로 변경
 */

const crypto = require('crypto');
const { getOrderById, updateOrderStatus, updateOrderTossPaymentKey, updateOrderAcceptToken, getStores } = require('../_redis');
const { getAppOrigin, getTossSecretKeyForOrder } = require('./_helpers');
const { getStoreDisplayName, getStoresWithItemsInOrder, buildOrderNotificationHtml } = require('../orders/_order-email');
const { getProfileSettings } = require('../_redis');

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

    // 결제 완료 시 주문에 상품이 포함된 각 매장 담당자에게 해당 매장 메뉴만 담은 주문서 메일 발송
    const orderAfter = await getOrderById(orderIdStr);
    const stores = await getStores();
    if (orderAfter && Array.isArray(stores) && stores.length > 0 && process.env.RESEND_API_KEY) {
      try {
        const pdfToken = crypto.randomBytes(24).toString('hex');
        await updateOrderAcceptToken(orderIdStr, pdfToken);
        const pdfUrl = `${origin}/api/orders/pdf?orderId=${encodeURIComponent(orderIdStr)}&token=${encodeURIComponent(pdfToken)}`;
        const profile = await getProfileSettings(orderAfter.user_email || '');
        const profileStoreName = (profile?.storeName || '').trim();
        const { Resend } = require('resend');
        const resend = new Resend(process.env.RESEND_API_KEY);
        const fromEmail = (process.env.RESEND_FROM_EMAIL || '').trim() || 'onboarding@resend.dev';
        const fromName = process.env.RESEND_FROM_NAME || 'Zero Mart';
        const storeEntries = getStoresWithItemsInOrder(orderAfter, stores);
        for (const { store, slug, items } of storeEntries) {
          const toEmail = (store?.storeContactEmail || '').trim();
          if (!toEmail) continue;
          const orderForStore = { ...orderAfter, order_items: items };
          const html = buildOrderNotificationHtml(orderForStore, stores, { pdfUrl, profileStoreName });
          const storeBrand = getStoreDisplayName(store);
          await resend.emails.send({
            from: `${fromName} <${fromEmail}>`,
            to: toEmail,
            subject: `[Zero Mart 신규 주문] ${storeBrand} #${orderIdStr}`,
            html,
          });
        }
      } catch (emailErr) {
        console.error('Order notification email (payment_completed) error:', emailErr);
      }
    }

    return res.redirect(302, `${redirectBase}?payment=success`);
  } catch (err) {
    console.error('Payment success handler error:', err);
    return res.redirect(302, `${redirectBase}?payment=error`);
  }
};
