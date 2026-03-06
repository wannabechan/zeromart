/**
 * GET /api/cron/alimtalk-user-as-order
 * 배송 희망일 하루 다음 날에 고객에게 "잘 드셨는지" 인사 알림톡 발송
 * Vercel Cron 02:00 UTC (= 11:00 KST) 또는 외부 스케줄러에서 호출 (CRON_SECRET 필요)
 */

const { getAllOrders, updateOrderUserAsOrderSent } = require('../_redis');
const { sendAlimtalk } = require('../_alimtalk');

/** 날짜 문자열을 YYYY-MM-DD로 정규화 */
function normalizeDateKey(str) {
  if (!str || typeof str !== 'string') return '';
  const s = str.trim().replace(/\D/g, '');
  if (s.length === 8) return `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}`;
  return '';
}

/** KST 기준 어제 날짜 문자열 (YYYY-MM-DD) */
function getYesterdayKstStr() {
  const now = new Date();
  const kst = new Date(now.getTime() + 9 * 60 * 60 * 1000);
  const yesterday = new Date(kst.getTime() - 24 * 60 * 60 * 1000);
  const y = yesterday.getUTCFullYear();
  const m = String(yesterday.getUTCMonth() + 1).padStart(2, '0');
  const d = String(yesterday.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

module.exports = async (req, res) => {
  if (req.method !== 'GET' && req.method !== 'POST') {
    return res.status(405).setHeader('Allow', 'GET, POST').end();
  }

  const secret = process.env.CRON_SECRET;
  const authHeader = req.headers.authorization || '';
  if (!authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  const token = authHeader.slice(7);
  if (!secret || token !== secret) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const templateCode = (process.env.NHN_ALIMTALK_TEMPLATE_CODE_USER_AS_ORDER || '').trim();
  if (!templateCode) {
    return res.status(200).json({ ok: true, sent: 0, message: 'NHN_ALIMTALK_TEMPLATE_CODE_USER_AS_ORDER not set' });
  }

  try {
    const yesterdayStr = getYesterdayKstStr();
    const orders = await getAllOrders();

    const toNotify = orders.filter((o) => {
      if ((o.status || '') !== 'delivery_completed') return false;
      if (o.user_as_order_sent) return false;
      const contact = (o.contact || '').toString().trim();
      if (!contact) return false;
      const deliveryNorm = normalizeDateKey(o.delivery_date || '');
      return deliveryNorm === yesterdayStr;
    });

    let sent = 0;
    for (const order of toNotify) {
      try {
        const depositor = (order.depositor || '').trim() || '고객';
        const recipientNo = (order.contact || '').toString().trim();

        const result = await sendAlimtalk({
          templateCode,
          recipientNo,
          templateParameter: {
            depositor,
          },
        });
        if (result.success) {
          await updateOrderUserAsOrderSent(order.id);
          sent += 1;
        }
      } catch (err) {
        console.error('Alimtalk user AS_ORDER error for order', order.id, err);
      }
    }

    return res.status(200).json({ ok: true, sent, total: toNotify.length });
  } catch (err) {
    console.error('Alimtalk user AS_ORDER cron error:', err);
    return res.status(500).json({ error: 'Cron failed' });
  }
};
