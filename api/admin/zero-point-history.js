/**
 * GET /api/admin/zero-point-history?email=
 * 관리자: 해당 계정의 제로포인트 변동 이력만 반환 (user 문서 전체 비노출).
 */

const { verifyToken, apiResponse } = require('../_utils');
const { getZeroPointHistoryByEmail } = require('../_redis');

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

    const emailRaw = typeof req.query.email === 'string' ? req.query.email.trim() : '';
    if (!emailRaw || !emailRaw.includes('@')) {
      return apiResponse(res, 400, { error: 'email 파라미터가 필요합니다.' });
    }

    const events = await getZeroPointHistoryByEmail(emailRaw);
    return apiResponse(res, 200, { events });
  } catch (e) {
    console.error('zero-point-history:', e);
    return apiResponse(res, 500, { error: '내역을 불러오지 못했습니다.' });
  }
};
