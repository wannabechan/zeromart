/**
 * POST /api/admin/zero-points-bonus-all
 * 관리자: 전체 사용자에게 동일 보너스 제로포인트 지급
 */

const { verifyToken, apiResponse } = require('../_utils');
const { grantAllUsersZeroPointsBySystemBonus, ZERO_POINT_SYSTEM_BONUS_MAX } = require('../_redis');

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

    const pointsRaw = String(body.points ?? '').trim();
    if (!/^\d+$/.test(pointsRaw)) {
      return apiResponse(res, 400, { error: '지급할 포인트는 숫자만 입력할 수 있습니다.' });
    }
    const points = Math.floor(Number(pointsRaw));
    if (!Number.isFinite(points) || points < 1) {
      return apiResponse(res, 400, { error: '지급할 포인트를 입력해 주세요.' });
    }
    if (points > ZERO_POINT_SYSTEM_BONUS_MAX) {
      return apiResponse(res, 400, { error: '지급 가능 범위를 초과합니다.' });
    }

    const result = await grantAllUsersZeroPointsBySystemBonus(points);
    return apiResponse(res, 200, { ok: true, ...result });
  } catch (e) {
    if (e && e.code === 'BULK_IN_PROGRESS') {
      return apiResponse(res, 409, { error: '다른 제로포인트 일괄 작업이 진행 중입니다. 잠시 후 다시 시도해 주세요.' });
    }
    if (e && e.code === 'INVALID_BONUS_POINTS') {
      return apiResponse(res, 400, { error: '지급 가능 범위를 초과합니다.' });
    }
    console.error('zero-points-bonus-all:', e);
    return apiResponse(res, 500, { error: '전체 보너스포인트 지급에 실패했습니다.' });
  }
};
