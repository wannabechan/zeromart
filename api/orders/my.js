/**
 * GET /api/orders/my
 * 현재 로그인 사용자의 주문 목록 조회
 */

const { verifyToken, apiResponse } = require('../_utils');
const { getOrdersByUser, getStores } = require('../_redis');
const { withHydratedSlips } = require('./_orderSlips');

const STATUS_LABELS = {
  submitted: '결제하기',
  order_accepted: '결제하기',
  payment_link_issued: '결제하기',
  payment_completed: '결제완료',
  shipping: '발송완료',
  delivery_completed: '발송완료',
  cancelled: '주문취소',
};

module.exports = async (req, res) => {
  if (req.method === 'OPTIONS') {
    return apiResponse(res, 200, {});
  }

  if (req.method !== 'GET') {
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

    const orders = await getOrdersByUser(user.email);
    const stores = await getStores() || [];

    const items = orders.map((raw) => {
      const o = withHydratedSlips(raw, stores);
      const status = o.status === 'pending' ? 'submitted' : (o.status || 'submitted');
      const baseLabel = STATUS_LABELS[status] || STATUS_LABELS.submitted;
      const statusLabel = status === 'cancelled' && o.cancel_reason
        ? `${baseLabel}(${o.cancel_reason})`
        : baseLabel;
      const slips = Array.isArray(o.order_slips) ? o.order_slips.map((s) => ({
        slipIndex: s.slipIndex,
        slug: s.slug,
        deliveryStatus: s.delivery_status,
        courierCompany: s.courier_company || null,
        trackingNumber: s.tracking_number || null,
        deliveryType: s.delivery_type || null,
      })) : [];
      return {
        id: o.id,
        status,
        statusLabel,
        createdAt: o.created_at,
        paymentCompletedAt: o.payment_completed_at || null,
        deliveryAddress: o.delivery_address || null,
        detailAddress: o.detail_address || null,
        totalAmount: o.total_amount,
        orderItems: o.order_items || [],
        pdfUrl: o.pdf_url || null,
        paymentLink: o.payment_link || null,
        courierCompany: o.courier_company || null,
        trackingNumber: o.tracking_number || null,
        deliveryType: o.delivery_type || null,
        orderSlips: slips,
      };
    });

    return apiResponse(res, 200, { orders: items });
  } catch (error) {
    console.error('Get my orders error:', error);
    return apiResponse(res, 500, { error: '서버 오류가 발생했습니다.' });
  }
};
