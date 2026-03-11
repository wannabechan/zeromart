/**
 * GET /api/brand-manager/stores
 * 브랜드 매니저가 권한을 가진 매장(그룹) 목록 (admin 또는 브랜드 매니저 전용)
 */

const { verifyToken, apiResponse } = require('../_utils');
const { getAllowedStoresForManager, getAllowedStoresForManagerExpanded } = require('./_helpers');

module.exports = async (req, res) => {
  if (req.method === 'OPTIONS') return apiResponse(res, 200, {});
  if (req.method !== 'GET') return apiResponse(res, 405, { error: 'Method not allowed' });

  try {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return apiResponse(res, 401, { error: '로그인이 필요합니다.' });
    }
    const user = verifyToken(authHeader.substring(7));
    if (!user) return apiResponse(res, 401, { error: '로그인이 필요합니다.' });
    const isAdmin = user.level === 'admin';
    const userEmail = (user.email || '').trim().toLowerCase();
    const directlyAllowed = await getAllowedStoresForManager(userEmail);
    const isBrandManager = directlyAllowed.length > 0;
    if (!isAdmin && !isBrandManager) {
      return apiResponse(res, 403, { error: '브랜드 매니저 권한이 필요합니다.' });
    }

    const stores = isAdmin
      ? await require('../_redis').getStores() || []
      : await getAllowedStoresForManagerExpanded(userEmail);
    return apiResponse(res, 200, { stores });
  } catch (error) {
    console.error('Brand manager stores error:', error);
    return apiResponse(res, 500, { error: '서버 오류가 발생했습니다.' });
  }
};
