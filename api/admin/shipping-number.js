/**
 * POST /api/admin/shipping-number
 * 배송 번호(전화번호 형식) 저장 및 주문 상태를 배송중으로 변경 (admin 전용)
 */

const { verifyToken, apiResponse } = require('../_utils');
const { getOrderById, updateOrderShippingNumber } = require('../_redis');

function isAdmin(user) {
  return user && user.level === 'admin';
}

/**
 * 대한민국 휴대폰·전화번호만 허용 (숫자만 사용, 9~11자리, 0으로 시작)
 * 예: 0212345678, 01012345678, 0311234567
 */
function isValidTrackingNumber(value) {
  const s = String(value || '').replace(/\D/g, '');
  if (!s) return false;
  if (s.length < 9 || s.length > 11) return false;
  if (s[0] !== '0') return false;
  return true;
}

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

    const user = verifyToken(authHeader.substring(7));
    if (!user || !isAdmin(user)) {
      return apiResponse(res, 403, { error: '관리자만 접근할 수 있습니다.' });
    }

    const { orderId, trackingNumber } = req.body || {};
    if (!orderId || typeof orderId !== 'string') {
      return apiResponse(res, 400, { error: '주문 번호가 필요합니다.' });
    }

    if (!isValidTrackingNumber(trackingNumber)) {
      return apiResponse(res, 400, { error: '대한민국 휴대폰 또는 전화번호만 입력 가능합니다.' });
    }

    const order = await getOrderById(orderId.trim());
    if (!order) {
      return apiResponse(res, 404, { error: '주문을 찾을 수 없습니다.' });
    }

    if (order.status !== 'payment_completed') {
      return apiResponse(res, 400, { error: '결제 완료된 주문만 배송 번호를 등록할 수 있습니다.' });
    }

    await updateOrderShippingNumber(orderId.trim(), String(trackingNumber).replace(/\D/g, '').trim());
    return apiResponse(res, 200, { success: true });
  } catch (err) {
    console.error('Admin shipping-number error:', err);
    return apiResponse(res, 500, { error: '서버 오류가 발생했습니다.' });
  }
};
