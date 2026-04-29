/**
 * POST /api/admin/delivery-complete
 * 슬립(주문서) 단위 발송 완료 (admin). 전 슬립 완료 시에만 주문 status = delivery_completed.
 */

const { verifyToken, apiResponse, isAdmin } = require('../_utils');
const { getStores } = require('../_redis');
const { getStoresWithItemsInOrder } = require('../orders/_order-email');
const { persistSlipsIfMissing, applySlipDeliveryComplete } = require('../orders/_orderSlips');
const { appendOrderRawLog } = require('../_orderRawLog');

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

    const { orderId, code, courierCompany, trackingNumber, slipIndex: slipIndexRaw } = req.body || {};
    if (!orderId || typeof orderId !== 'string') {
      return apiResponse(res, 400, { error: '주문 번호가 필요합니다.' });
    }

    const stores = await getStores() || [];
    const order = await persistSlipsIfMissing(orderId.trim(), stores);
    if (!order) {
      return apiResponse(res, 404, { error: '주문을 찾을 수 없습니다.' });
    }

    if (order.status !== 'payment_completed' && order.status !== 'shipping') {
      return apiResponse(res, 400, { error: '결제 완료된 주문만 발송 완료 처리할 수 있습니다.' });
    }

    const entries = getStoresWithItemsInOrder(order, stores);
    let slipIndex = 0;
    if (entries.length > 1) {
      if (slipIndexRaw === undefined || slipIndexRaw === null) {
        return apiResponse(res, 400, { error: '복수 매장 주문입니다. slipIndex(0부터)로 주문서를 지정해 주세요.' });
      }
      slipIndex = parseInt(slipIndexRaw, 10);
      if (Number.isNaN(slipIndex) || slipIndex < 0 || slipIndex >= entries.length) {
        return apiResponse(res, 400, { error: '유효하지 않은 slipIndex입니다.' });
      }
    }

    const hasParcel = (courierCompany != null && String(courierCompany).trim() !== '') || (trackingNumber != null && String(trackingNumber).trim() !== '');

    if (hasParcel) {
      const courier = String(courierCompany || '').trim();
      const tracking = String(trackingNumber || '').trim();
      if (!tracking) {
        return apiResponse(res, 400, { error: '송장 번호를 입력해 주세요.' });
      }
      const r = await applySlipDeliveryComplete(orderId.trim(), stores, slipIndex, {
        deliveryType: 'parcel',
        courierCompany: courier || null,
        trackingNumber: tracking,
      });
      if (!r.ok) {
        return apiResponse(res, 400, { error: r.error || '처리에 실패했습니다.' });
      }
      appendOrderRawLog(r.order, {
        eventType: 'delivery_completed',
        statusAfter: r.order.status,
        actor: 'admin',
        note: `발송 완료 처리 (슬립 ${slipIndex + 1})`,
      }).catch((e) => console.error('[orderRawLog]', e.message));
      return apiResponse(res, 200, { success: true });
    }

    const codeTrim = (code || '').trim();
    const baseFromCode = codeTrim.replace(/^주문\s*#?\s*/, '').replace(/-\d+$/, '');
    const valid = codeTrim === orderId || codeTrim === `주문 #${orderId}` || baseFromCode === orderId;
    if (!valid) {
      return apiResponse(res, 400, { error: '발송 완료 승인 코드 오류' });
    }

    const r = await applySlipDeliveryComplete(orderId.trim(), stores, slipIndex, { deliveryType: 'direct' });
    if (!r.ok) {
      return apiResponse(res, 400, { error: r.error || '처리에 실패했습니다.' });
    }
    appendOrderRawLog(r.order, {
      eventType: 'delivery_completed',
      statusAfter: r.order.status,
      actor: 'admin',
      note: `발송 완료 처리 직접배송 (슬립 ${slipIndex + 1})`,
    }).catch((e) => console.error('[orderRawLog]', e.message));
    return apiResponse(res, 200, { success: true });
  } catch (err) {
    console.error('Admin delivery-complete error:', err);
    return apiResponse(res, 500, { error: '서버 오류가 발생했습니다.' });
  }
};
