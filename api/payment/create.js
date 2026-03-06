/**
 * POST /api/payment/create
 * Toss Payments 결제 생성 (Secret Key 서버 전용)
 */

const { verifyToken, apiResponse } = require('../_utils');
const { getOrderById } = require('../_redis');
const { getAppOrigin, getTossSecretKeyForOrder } = require('./_helpers');

const TOSS_API = 'https://api.tosspayments.com/v1/payments';

module.exports = async (req, res) => {
  if (req.method === 'OPTIONS') return require('../_utils').apiResponse(res, 200, {});

  if (req.method !== 'POST') {
    return apiResponse(res, 405, { error: 'Method not allowed' });
  }

  try {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return apiResponse(res, 401, { error: '로그인이 필요합니다.' });
    }

    const user = verifyToken(authHeader.substring(7));
    if (!user) return apiResponse(res, 401, { error: '로그인이 필요합니다.' });

    const { orderId } = req.body && typeof req.body === 'object' ? req.body : {};
    if (!orderId || typeof orderId !== 'string') {
      return apiResponse(res, 400, { error: '주문 번호가 필요합니다.' });
    }

    const order = await getOrderById(orderId);
    if (!order) return apiResponse(res, 404, { error: '주문을 찾을 수 없습니다.' });
    if (order.user_email !== user.email) {
      return apiResponse(res, 403, { error: '해당 주문에 대한 권한이 없습니다.' });
    }

    const status = order.status || 'submitted';
    if (status !== 'submitted' && status !== 'payment_link_issued') {
      return apiResponse(res, 400, { error: '결제할 수 없는 주문 상태입니다.' });
    }

    const amount = Number(order.total_amount);
    if (!Number.isInteger(amount) || amount < 100) {
      return apiResponse(res, 400, { error: '유효한 결제 금액이 아닙니다.' });
    }

    const TOSS_SECRET_KEY = await getTossSecretKeyForOrder(order);
    if (!TOSS_SECRET_KEY) {
      return apiResponse(res, 503, { error: '결제 설정이 되어 있지 않습니다.' });
    }

    const origin = getAppOrigin(req);
    const successUrl = `${origin}/api/payment/success?orderId=${encodeURIComponent(orderId)}`;
    const failUrl = `${origin}/api/payment/fail?orderId=${encodeURIComponent(orderId)}`;

    const body = {
      method: 'CARD',
      amount,
      currency: 'KRW',
      orderId: String(orderId),
      orderName: `BzCat 주문 #${orderId}`,
      successUrl,
      failUrl,
    };

    const auth = Buffer.from(`${TOSS_SECRET_KEY}:`, 'utf8').toString('base64');
    const createRes = await fetch(TOSS_API, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Basic ${auth}`,
      },
      body: JSON.stringify(body),
    });

    const data = await createRes.json().catch(() => ({}));

    if (!createRes.ok) {
      console.error('Toss payment create failed:', createRes.status, data);
      const errObj = data.error;
      const msg =
        (typeof errObj === 'object' && errObj !== null && errObj.message) ||
        data.message ||
        data.msg ||
        data.errorMessage ||
        (data.code ? String(data.code) : '') ||
        '결제 요청에 실패했습니다.';
      const errorText = typeof msg === 'string' ? msg.trim() : String(msg || '').trim();
      return apiResponse(res, createRes.status >= 500 ? 502 : 400, {
        error: errorText || '결제 요청에 실패했습니다.',
      });
    }

    const checkoutUrl = data.nextRedirectPcUrl || data.nextRedirectMobileUrl || data.checkout?.url || data.url;
    if (!checkoutUrl) {
      return apiResponse(res, 502, { error: '결제 URL을 받지 못했습니다.' });
    }

    return apiResponse(res, 200, { checkoutUrl });
  } catch (err) {
    console.error('Payment create error:', err);
    return apiResponse(res, 500, { error: '서버 오류가 발생했습니다.' });
  }
};
