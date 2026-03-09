/**
 * GET /api/menu-data
 * 메뉴 데이터 조회. Authorization 있으면 해당 사용자에게 허용된 매장만 반환, 없으면 빈 객체(비로그인 시 매장 미노출).
 */

const { getMenuDataForApp } = require('./_redis');
const { verifyToken, apiResponse } = require('./_utils');

module.exports = async (req, res) => {
  if (req.method === 'OPTIONS') {
    return apiResponse(res, 200, {});
  }

  if (req.method !== 'GET') {
    return apiResponse(res, 405, { error: 'Method not allowed' });
  }

  try {
    let userEmail = null;
    const authHeader = req.headers.authorization;
    if (authHeader && authHeader.startsWith('Bearer ')) {
      const user = verifyToken(authHeader.substring(7));
      if (user && user.email) userEmail = user.email;
    }
    if (!userEmail) {
      return apiResponse(res, 200, {});
    }
    const data = await getMenuDataForApp(userEmail);
    return apiResponse(res, 200, data);
  } catch (error) {
    console.error('Menu data error:', error);
    return apiResponse(res, 500, { error: '메뉴 데이터를 불러올 수 없습니다.' });
  }
};
