/**
 * GET /api/admin/zero-points-users
 * 어드민: 제로포인트 요약이 있는 사용자 목록 (이메일 오름차순)
 */

const { verifyToken, apiResponse } = require('../_utils');
const { getAdminZeroPointUserRows } = require('../_redis');

module.exports = async (req, res) => {
  if (req.method === 'OPTIONS') return apiResponse(res, 200, {});
  if (req.method !== 'GET') return apiResponse(res, 405, { error: 'Method not allowed' });

  try {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return apiResponse(res, 401, { error: '로그인이 필요합니다.' });
    }
    const token = authHeader.substring(7);
    const user = verifyToken(token);
    if (!user) return apiResponse(res, 401, { error: '로그인이 필요합니다.' });
    if (user.level !== 'admin') return apiResponse(res, 403, { error: '관리자만 접근할 수 있습니다.' });

    const rows = await getAdminZeroPointUserRows();
    return apiResponse(res, 200, { rows });
  } catch (e) {
    console.error('zero-points-users:', e);
    return apiResponse(res, 500, { error: '목록을 불러오지 못했습니다.' });
  }
};
