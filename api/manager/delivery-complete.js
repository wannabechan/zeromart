/**
 * POST /api/manager/delivery-complete
 * 본인 매장 슬립(주문서) 단위 발송 완료. 전 슬립 완료 시에만 주문 status = delivery_completed.
 */

const { verifyToken, apiResponse } = require('../_utils');
const { getStores } = require('../_redis');
const { getStoresWithItemsInOrder } = require('../orders/_order-email');
const { persistSlipsIfMissing, applySlipDeliveryComplete, findManagerSlipIndex } = require('../orders/_orderSlips');
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
    if (!user) {
      return apiResponse(res, 401, { error: '로그인이 필요합니다.' });
    }

    const managerEmail = (user.email || '').trim().toLowerCase();
    if (!managerEmail) {
      return apiResponse(res, 403, { error: '담당자로 등록된 매장이 없습니다.' });
    }

    const { orderId, code, courierCompany, trackingNumber } = req.body || {};
    if (!orderId || typeof orderId !== 'string') {
      return apiResponse(res, 400, { error: '주문 번호가 필요합니다.' });
    }

    const stores = await getStores() || [];
    const order = await persistSlipsIfMissing(orderId.trim(), stores);
    if (!order) {
      return apiResponse(res, 404, { error: '주문을 찾을 수 없습니다.' });
    }

    const entries = getStoresWithItemsInOrder(order, stores);
    const hasManagerStore = entries.some((e) => (e.store?.storeContactEmail || '').trim().toLowerCase() === managerEmail);
    if (!hasManagerStore) {
      return apiResponse(res, 403, { error: '본인 매장 주문만 발송 완료 처리할 수 있습니다.' });
    }

    if (order.status !== 'payment_completed' && order.status !== 'shipping') {
      return apiResponse(res, 400, { error: '결제 완료된 주문만 발송 완료 처리할 수 있습니다.' });
    }

    const slipIndex = findManagerSlipIndex(order, stores, managerEmail);
    if (slipIndex < 0) {
      return apiResponse(res, 403, { error: '본인 매장 주문만 발송 완료 처리할 수 있습니다.' });
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
        return apiResponse(res, 400, { error: r.error || '저장에 실패했습니다.' });
      }
      appendOrderRawLog(r.order, {
        eventType: 'delivery_completed',
        statusAfter: r.order.status,
        actor: 'manager',
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
      actor: 'manager',
      note: `발송 완료 처리 직접배송 (슬립 ${slipIndex + 1})`,
    }).catch((e) => console.error('[orderRawLog]', e.message));
    return apiResponse(res, 200, { success: true });
  } catch (err) {
    console.error('Manager delivery-complete error:', err);
    return apiResponse(res, 500, { error: '서버 오류가 발생했습니다.' });
  }
};
