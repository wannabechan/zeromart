/**
 * GET /api/cron/send-order-notifications
 * 결제 완료 45분이 지난 주문에 대해 매장 담당자에게 주문서 메일 발송 (한 번만).
 * 제로포인트 적립은 /api/cron/zero-point-reward 에서 별도 실행.
 * CRON_SECRET 필요 (Authorization: Bearer <CRON_SECRET>).
 */

const {
  getAllOrders,
  getStores,
  getProfileSettings,
  getOrderById,
  saveOrder,
  appendResendLog,
} = require('../_redis');
const { requireAuthCron, generateOrderPdfAccessToken } = require('../_utils');
const {
  getStoresWithItemsInOrder,
  getOrderNumberForStoreIndex,
  buildOrderNotificationHtml,
  getStoreDisplayName,
} = require('../orders/_order-email');

const PAYMENT_CANCEL_WINDOW_MS = 45 * 60 * 1000;

function isEligibleForNotification(order) {
  if ((order.status || '') !== 'payment_completed') return false;
  if (order.order_notification_sent) return false;
  const at = order.payment_completed_at;
  if (!at) return false;
  const ts = new Date(at).getTime();
  if (Number.isNaN(ts)) return false;
  return Date.now() - ts >= PAYMENT_CANCEL_WINDOW_MS;
}

module.exports = async (req, res) => {
  if (req.method !== 'GET' && req.method !== 'POST') {
    return res.status(405).setHeader('Allow', 'GET, POST').end();
  }

  if (!requireAuthCron(req)) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  if (!process.env.RESEND_API_KEY) {
    return res.status(200).json({ ok: true, sent: 0, message: 'RESEND_API_KEY not set' });
  }

  const origin = (process.env.APP_ORIGIN || '').trim() || '';

  try {
    const orders = await getAllOrders();
    const toSend = orders.filter(isEligibleForNotification);
    const stores = await getStores() || [];
    const { Resend } = require('resend');
    const resend = new Resend(process.env.RESEND_API_KEY);
    const fromEmail = (process.env.RESEND_FROM_EMAIL || '').trim() || 'onboarding@resend.dev';
    const fromName = process.env.RESEND_FROM_NAME || 'Zero Mart';

    let sent = 0;
    for (const order of toSend) {
      const orderIdStr = String(order.id);
      const storeEntries = getStoresWithItemsInOrder(order, stores);
      storeEntries.forEach((entry, index) => {
        entry.orderNumberDisplay = getOrderNumberForStoreIndex(orderIdStr, index);
      });

      let anySent = false;
      const noticeResults = [];
      for (const { store, slug, items, orderNumberDisplay } of storeEntries) {
        const toEmail = (store?.storeContactEmail || '').trim();
        if (!toEmail) continue;
        const profile = await getProfileSettings(order.user_email || '');
        const profileStoreName = (profile?.storeName || '').trim();
        const pdfAccessToken = generateOrderPdfAccessToken(orderIdStr, slug, order.accept_token || '');
        const pdfUrl = origin
          ? `${origin}/api/orders/pdf?orderId=${encodeURIComponent(orderIdStr)}&store=${encodeURIComponent(slug)}&access=${encodeURIComponent(pdfAccessToken)}`
          : '#';
        const orderForStore = { ...order, order_items: items };
        const html = buildOrderNotificationHtml(orderForStore, stores, {
          pdfUrl,
          profileStoreName,
          orderNumberDisplay,
        });
        const storeBrand = getStoreDisplayName(store);
        const attemptedAt = new Date().toISOString();
        try {
          const sendResult = await resend.emails.send({
            from: `${fromName} <${fromEmail}>`,
            to: toEmail,
            subject: `[Zero Mart 신규 주문] ${storeBrand} ${orderNumberDisplay}`,
            html,
          });
          if (sendResult.error) {
            const errMsg = sendResult.error.message || JSON.stringify(sendResult.error);
            noticeResults.push({ slug, ok: false, at: attemptedAt, error: String(errMsg).slice(0, 300) });
            await appendResendLog({
              ok: false,
              kind: 'order_notification',
              toEmail: toEmail,
              errorMessage: errMsg,
            });
          } else {
            noticeResults.push({ slug, ok: true, at: attemptedAt, error: null });
            await appendResendLog({
              ok: true,
              kind: 'order_notification',
              toEmail: toEmail,
              resendId: sendResult.data?.id || null,
            });
            anySent = true;
            sent += 1;
          }
        } catch (sendErr) {
          const errMsg = sendErr?.message || String(sendErr);
          noticeResults.push({ slug, ok: false, at: attemptedAt, error: String(errMsg).slice(0, 300) });
          await appendResendLog({
            ok: false,
            kind: 'order_notification',
            toEmail: toEmail,
            errorMessage: errMsg,
          });
        }
      }

      // 대상 매장 0곳(담당 이메일 없음)이거나 1곳 이상 성공하면 재시도 대상에서 제외.
      // 대상이 있는데 전부 실패하면 order_notification_sent는 그대로 false → 기존처럼 재시도.
      const doneForRetry = anySent || noticeResults.length === 0;
      try {
        const fresh = (await getOrderById(orderIdStr)) || order;
        fresh.order_notification_results = noticeResults;
        fresh.order_notification_checked = true;
        if (doneForRetry) fresh.order_notification_sent = true;
        await saveOrder(fresh);
      } catch (saveErr) {
        console.error('Send order notifications: save results', orderIdStr, saveErr.message);
        if (doneForRetry) {
          try {
            const fresh = await getOrderById(orderIdStr);
            if (fresh) {
              fresh.order_notification_sent = true;
              fresh.order_notification_results = noticeResults;
              fresh.order_notification_checked = true;
              await saveOrder(fresh);
            }
          } catch (flagErr) {
            console.error('Send order notifications: mark sent', orderIdStr, flagErr.message);
          }
        }
      }
    }

    return res.status(200).json({ ok: true, sent, checked: orders.length });
  } catch (err) {
    console.error('Send order notifications error:', err);
    return res.status(500).json({ error: 'Send notifications failed' });
  }
};
