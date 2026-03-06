/**
 * GET  /api/profile/settings - 로그인 사용자의 프로필 설정 조회
 * PUT  /api/profile/settings - 로그인 사용자의 프로필 설정 저장
 * Body (PUT): { storeName, bizNumber, name, contact, address, detailAddress }
 */

const { verifyToken, apiResponse } = require('../_utils');
const { getProfileSettings, setProfileSettings } = require('../_redis');

module.exports = async (req, res) => {
  if (req.method === 'OPTIONS') {
    return apiResponse(res, 200, {});
  }

  if (req.method !== 'GET' && req.method !== 'PUT') {
    return apiResponse(res, 405, { error: 'Method not allowed' });
  }

  try {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return apiResponse(res, 401, { error: '로그인이 필요합니다.' });
    }

    const token = authHeader.substring(7);
    const user = verifyToken(token);
    if (!user) {
      return apiResponse(res, 401, { error: '로그인이 필요합니다.' });
    }

    const email = (user.email || '').trim();
    if (!email) {
      return apiResponse(res, 400, { error: '이메일 정보가 없습니다.' });
    }

    if (req.method === 'GET') {
      const data = await getProfileSettings(email);
      return apiResponse(res, 200, { settings: data || {} });
    }

    if (req.method === 'PUT') {
      const body = typeof req.body === 'object' && req.body !== null ? req.body : {};
      await setProfileSettings(email, {
        storeName: body.storeName,
        bizNumber: body.bizNumber,
        name: body.name,
        contact: body.contact,
        address: body.address,
        detailAddress: body.detailAddress,
      });
      return apiResponse(res, 200, { success: true, message: '저장되었습니다.' });
    }
  } catch (error) {
    console.error('Profile settings API error:', error);
    return apiResponse(res, 500, { error: '서버 오류가 발생했습니다.' });
  }
};
