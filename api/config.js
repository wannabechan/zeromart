/**
 * GET /api/config
 * 공개 설정 값 (프론트에서 사용, 인증 불필요)
 * emailAdmin: 문의용 이메일 (환경변수 EMAIL_ADMIN)
 */

const { apiResponse } = require('./_utils');

module.exports = async (req, res) => {
  if (req.method === 'OPTIONS') {
    return apiResponse(res, 200, {});
  }

  if (req.method !== 'GET') {
    return apiResponse(res, 405, { error: 'Method not allowed' });
  }

  try {
    const emailAdmin = process.env.EMAIL_ADMIN || '';
    return apiResponse(res, 200, { emailAdmin });
  } catch (error) {
    console.error('Config error:', error);
    return apiResponse(res, 500, { emailAdmin: '' });
  }
};
