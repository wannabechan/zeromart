/**
 * POST /api/admin/emergency-cancel-order
 * 어드민 긴급 취소: 결제 완료(주문완료) 이후에도 토스 결제 취소 + 주문 취소
 * (고객 45분 내 결제취소와 동일 처리. 공급업체 통보는 본사 수동 처리 전제)
 */

const { getOrderById, getStores, saveOrder } = require('../_redis');
const { cancelOrderAndRegeneratePdf } = require('../_orderCancel');
const { verifyToken, apiResponse, isAdmin } = require('../_utils');
const { withHydratedSlips } = require('../orders/_orderSlips');
const { getTossSecretKeyForOrder } = require('../payment/_helpers');
const { buildVatPaymentSnapshotFromToss } = require('../payment/_vatPayment');

const TOSS_CANCEL_API = 'https://api.tosspayments.com/v1/payments';
const EMERGENCY_CANCELABLE = ['payment_completed', 'shipping'];

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

    const { orderId, confirmOrderId } = req.body && typeof req.body === 'object' ? req.body : {};
    const id = orderId != null ? String(orderId).trim() : '';
    if (!id) {
      return apiResponse(res, 400, { error: 'orderId가 필요합니다.' });
    }

    const confirmRaw = confirmOrderId != null ? String(confirmOrderId).trim() : '';
    if (!confirmRaw) {
      return apiResponse(res, 400, { error: '취소할 주문서 번호를 입력해 주세요.' });
    }
    const confirmNorm = confirmRaw.replace(/^주문\s*#?/i, '').replace(/^#/, '').trim();
    const confirmBase = confirmNorm.split('-')[0] || '';
    if (confirmNorm !== id && confirmBase !== id) {
      return apiResponse(res, 400, { error: '주문서 번호가 일치하지 않습니다.' });
    }

    const order = await getOrderById(id);
    if (!order) {
      return apiResponse(res, 404, { error: '주문을 찾을 수 없습니다.' });
    }

    const status = order.status === 'pending' ? 'submitted' : (order.status || 'submitted');
    if (status === 'cancelled') {
      return apiResponse(res, 400, { error: '이미 취소된 주문입니다.' });
    }
    if (!EMERGENCY_CANCELABLE.includes(status)) {
      return apiResponse(res, 400, {
        error: '주문완료(결제 완료) 상태의 주문만 긴급 취소할 수 있습니다.',
      });
    }

    const stores = await getStores() || [];
    const hydrated = withHydratedSlips(order, stores);
    if ((hydrated.status || status) === 'delivery_completed') {
      return apiResponse(res, 400, { error: '발송 완료된 주문은 긴급 취소할 수 없습니다.' });
    }

    const paymentKey = order.toss_payment_key || order.payment_key || '';
    if (!paymentKey.trim()) {
      return apiResponse(res, 400, {
        error: '결제 정보를 찾을 수 없어 취소할 수 없습니다.',
      });
    }

    const TOSS_SECRET_KEY = await getTossSecretKeyForOrder(order);
    if (!TOSS_SECRET_KEY) {
      return apiResponse(res, 503, { error: '결제 설정을 찾을 수 없습니다.' });
    }

    const auth = Buffer.from(`${TOSS_SECRET_KEY}:`, 'utf8').toString('base64');
    const cancelRes = await fetch(`${TOSS_CANCEL_API}/${encodeURIComponent(paymentKey.trim())}/cancel`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Basic ${auth}`,
      },
      body: JSON.stringify({
        cancelReason: '관리자 긴급 취소',
      }),
    });
    const cancelData = await cancelRes.json().catch(() => ({}));
    if (!cancelRes.ok) {
      const errMsg = cancelData.message || cancelData.error?.message || cancelData.msg || '결제 취소에 실패했습니다.';
      console.error('Admin emergency Toss cancel failed:', cancelRes.status, cancelData);
      return apiResponse(res, cancelRes.status >= 500 ? 502 : 400, {
        error: typeof errMsg === 'string' ? errMsg : '결제 취소에 실패했습니다.',
      });
    }

    await cancelOrderAndRegeneratePdf(id, '결제취소');
    try {
      const after = await getOrderById(id);
      if (after) {
        after.cancelled_at = new Date().toISOString();
        after.vat_payment = buildVatPaymentSnapshotFromToss(cancelData);
        await saveOrder(after);
      }
    } catch (vatErr) {
      console.error('Admin emergency cancel: vat_payment snapshot', vatErr.message);
    }

    return apiResponse(res, 200, {
      success: true,
      message: '주문이 긴급 취소되었습니다.',
    });
  } catch (error) {
    console.error('Admin emergency cancel order error:', error);
    return apiResponse(res, 500, { error: '서버 오류가 발생했습니다.' });
  }
};
