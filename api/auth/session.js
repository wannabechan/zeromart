/**
 * GET /api/auth/session
 * JWT 토큰으로 세션 검증
 * user.isStoreManager: 매장 담당자(storeContactEmail)로 등록된 매장이 있을 때 true
 * user.isBrandManager: 브랜드 매니저(managerEmails 또는 마스터)로 등록된 경우 true
 */

const { verifyToken, getUserLevel, apiResponse, isAdminEmail } = require('../_utils');
const { getStores } = require('../_redis');

function isStoreManagerEmail(email, stores) {
  if (!email || !Array.isArray(stores)) return false;
  const normalized = String(email).trim().toLowerCase();
  return stores.some(
    (s) => (s.storeContactEmail || '').trim().toLowerCase() === normalized
  );
}

function isBrandManagerEmail(email, stores) {
  if (!email || !Array.isArray(stores)) return false;
  const normalized = String(email).trim().toLowerCase();
  if (isAdminEmail(normalized)) return true;
  return stores.some((s) => {
    const list = Array.isArray(s.managerEmails) ? s.managerEmails : [];
    return list.some((e) => {
      const em = e && typeof e === 'object' && e.email != null ? String(e.email).trim().toLowerCase() : String(e).trim().toLowerCase();
      return em === normalized;
    });
  });
}

module.exports = async (req, res) => {
  if (req.method === 'OPTIONS') {
    return apiResponse(res, 200, {});
  }

  if (req.method !== 'GET') {
    return apiResponse(res, 405, { error: 'Method not allowed' });
  }

  try {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return apiResponse(res, 401, { error: '인증 토큰이 필요합니다.' });
    }

    const token = authHeader.substring(7);
    const decoded = verifyToken(token);
    if (!decoded) {
      return apiResponse(res, 401, { error: '로그인이 필요합니다.' });
    }

    // 항상 현재 EMAIL_ADMIN 기준으로 레벨 반영 (환경 변수 변경 시 재로그인 없이 반영)
    const level = getUserLevel(decoded.email);
    const stores = await getStores();
    const isStoreManager = isStoreManagerEmail(decoded.email, stores || []);
    const isBrandManager = isBrandManagerEmail(decoded.email, stores || []);

    const body = {
      success: true,
      user: {
        email: decoded.email,
        level,
        isStoreManager: !!isStoreManager,
        isBrandManager: !!isBrandManager,
      },
    };
    // 디버그 필요 시에만: DEBUG_SESSION=1 로 명시했을 때만 _debug 포함
    if (process.env.DEBUG_SESSION === '1') {
      body._debug = {
        emailFromToken: decoded.email || null,
        levelReturned: level,
        emailAdminSet: !!(process.env.EMAIL_ADMIN && process.env.EMAIL_ADMIN.trim()),
      };
    }
    return apiResponse(res, 200, body);
  } catch (error) {
    console.error('Session verification error:', error);
    return apiResponse(res, 500, { error: '서버 오류가 발생했습니다.' });
  }
};
