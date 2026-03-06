/**
 * POST /api/admin/payment-link
 * 주문의 결제 링크 설정 (admin 전용)
 */

const { verifyToken, apiResponse } = require('../_utils');
const { getOrderById, updateOrderPaymentLink, updateOrderStatus, getStores } = require('../_redis');
const { getStoreForOrder, getStoreDisplayName } = require('../orders/_order-email');
const { sendAlimtalk } = require('../_alimtalk');

module.exports = async (req, res) => {
  if (req.method === 'OPTIONS') {
    return apiResponse(res, 200, {});
  }

  if (req.method !== 'POST') {
    return apiResponse(res, 405, { error: 'Method not allowed' });
  }

  try {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return apiResponse(res, 401, { error: '로그인이 필요합니다.' });
    }

    const token = authHeader.substring(7);
    const user = verifyToken(token);

    if (!user) {
      return apiResponse(res, 401, { error: '로그인이 필요합니다.' });
    }

    const isAdmin = user.level === 'admin';
    if (!isAdmin) {
      return apiResponse(res, 403, { error: '관리자만 접근할 수 있습니다.' });
    }

    const { orderId, paymentLink } = req.body;
    if (!orderId) {
      return apiResponse(res, 400, { error: '주문 번호가 필요합니다.' });
    }

    const order = await getOrderById(orderId);
    if (!order) {
      return apiResponse(res, 404, { error: '주문을 찾을 수 없습니다.' });
    }

    await updateOrderPaymentLink(orderId, paymentLink || '');

    const trimmed = (paymentLink || '').trim();
    if (trimmed) {
      if (order.status === 'submitted' || order.status === 'order_accepted') {
        await updateOrderStatus(orderId, 'payment_link_issued');
        // 결제 링크 발급 시 주문자에게 결제 요청 알림톡
        const userPayaskCode = (process.env.NHN_ALIMTALK_TEMPLATE_CODE_USER_PAYASK_ORDER || '').trim();
        const orderContact = (order.contact || '').trim();
        if (userPayaskCode && orderContact) {
          try {
            const stores = await getStores();
            const store = getStoreForOrder(order, stores || []);
            const storeName = getStoreDisplayName(store);
            const totalAmountStr = Number(order.total_amount || 0).toLocaleString() + '원';
            const deliveryDateStr = (order.delivery_date || '').toString().trim() || '-';
            const depositorStr = (order.depositor || '').trim() || '-';
            await sendAlimtalk({
              templateCode: userPayaskCode,
              recipientNo: orderContact,
              templateParameter: {
                depositor: depositorStr,
                storeName,
                orderId: order.id,
                totalAmount: totalAmountStr,
                deliveryDate: deliveryDateStr,
              },
            });
          } catch (alimErr) {
            console.error('Alimtalk payask (user) error:', alimErr);
          }
        }
      }
    } else {
      if (order.status === 'payment_link_issued') {
        await updateOrderStatus(orderId, 'order_accepted');
      }
    }

    return apiResponse(res, 200, { success: true });
  } catch (error) {
    console.error('Admin set payment link error:', error);
    return apiResponse(res, 500, { error: '서버 오류가 발생했습니다.' });
  }
};
