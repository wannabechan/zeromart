/**
 * POST /api/manager/reject-order
 * 주문 접수 목록 페이지에서 매장 담당자가 거부(스케줄/조리/기타) 클릭 시 주문 취소
 * reason: schedule | cooking | other → 취소 사유: 매장 일정 이슈 | 매장 준비 이슈 | 매장 운영 이슈
 */

const { verifyToken, apiResponse } = require('../_utils');
const { getOrderById, getStores } = require('../_redis');
const { getStoreEmailForOrder } = require('../orders/_order-email');
const { cancelOrderAndRegeneratePdf } = require('../_orderCancel');

const REASON_TO_LABEL = {
  schedule: '매장일정이슈',
  cooking: '매장준비이슈',
  other: '매장운영이슈',
};

module.exports = async (req, res) => {
  if (req.method === 'OPTIONS') return apiResponse(res, 200, {});

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

    const { orderId, reason } = req.body || {};
    const id = (orderId || '').trim();
    const r = (reason || '').trim().toLowerCase();

    if (!id) {
      return apiResponse(res, 400, { error: '주문 번호가 필요합니다.' });
    }

    const cancelLabel = REASON_TO_LABEL[r];
    if (!cancelLabel) {
      return apiResponse(res, 400, { error: '유효한 거부 사유가 필요합니다.(schedule|cooking|other)' });
    }

    const stores = await getStores();
    const order = await getOrderById(id);
    if (!order) {
      return apiResponse(res, 404, { error: '주문을 찾을 수 없습니다.' });
    }

    const managerEmail = (getStoreEmailForOrder(order, stores) || '').trim().toLowerCase();
    const userEmail = (user.email || '').trim().toLowerCase();
    if (!managerEmail || managerEmail !== userEmail) {
      return apiResponse(res, 403, { error: '해당 주문의 담당자가 아닙니다.' });
    }

    const currentStatus = order.status || 'submitted';
    if (currentStatus !== 'submitted') {
      return apiResponse(res, 400, { error: '이미 처리된 주문입니다. 거부는 신청 완료 단계에서만 가능합니다.' });
    }

    await cancelOrderAndRegeneratePdf(id, cancelLabel);
    return apiResponse(res, 200, { success: true, message: '주문이 거부(취소)되었습니다.' });
  } catch (error) {
    console.error('Manager reject order error:', error);
    return apiResponse(res, 500, { error: '서버 오류가 발생했습니다.' });
  }
};
