/**
 * POST /api/admin/zero-points-reset-all
 * 관리자: 전체 사용자 제로포인트를 0으로 맞추고 시스템 초기화 차감 이력을 남깁니다.
 */

const { verifyToken, apiResponse } = require('../_utils');
const { resetAllUsersZeroPointsBySystemReset } = require('../_redis');

module.exports = async (req, res) => {
  if (req.method === 'OPTIONS') return apiResponse(res, 200, {});
  if (req.method !== 'POST') return apiResponse(res, 405, { error: 'Method not allowed' });

  try {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return apiResponse(res, 401, { error: '로그인이 필요합니다.' });
    }
    const token = authHeader.substring(7);
    const user = verifyToken(token);
    if (!user) return apiResponse(res, 401, { error: '로그인이 필요합니다.' });
    if (user.level !== 'admin') return apiResponse(res, 403, { error: '관리자만 접근할 수 있습니다.' });

    const body = req.body && typeof req.body === 'object' ? req.body : {};
    const confirmEmail = String(body.adminEmailConfirm || '').trim().toLowerCase();
    const adminEmail = String(user.email || '').trim().toLowerCase();
    if (!confirmEmail || !adminEmail || confirmEmail !== adminEmail) {
      return apiResponse(res, 400, { error: '관리자 계정 이메일이 일치하지 않습니다.' });
    }

    const result = await resetAllUsersZeroPointsBySystemReset();
    return apiResponse(res, 200, { ok: true, ...result });
  } catch (e) {
    if (e && e.code === 'RESET_IN_PROGRESS') {
      return apiResponse(res, 409, { error: '전체포인트 초기화가 이미 진행 중입니다. 잠시 후 다시 시도해 주세요.' });
    }
    console.error('zero-points-reset-all:', e);
    return apiResponse(res, 500, { error: '전체포인트 초기화에 실패했습니다.' });
  }
};
