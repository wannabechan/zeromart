/**
 * GET /api/menu-data
 * 메뉴 데이터 조회 (공개)
 */

const { getMenuDataForApp } = require('./_redis');
const { apiResponse } = require('./_utils');

module.exports = async (req, res) => {
  if (req.method === 'OPTIONS') {
    return apiResponse(res, 200, {});
  }

  if (req.method !== 'GET') {
    return apiResponse(res, 405, { error: 'Method not allowed' });
  }

  try {
    const data = await getMenuDataForApp();
    return apiResponse(res, 200, data);
  } catch (error) {
    console.error('Menu data error:', error);
    return apiResponse(res, 500, { error: '메뉴 데이터를 불러올 수 없습니다.' });
  }
};
