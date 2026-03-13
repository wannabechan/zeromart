/**
 * GET /api/admin/list-order-raw-logs
 * Blob에 저장된 주문 원시 로그 파일 목록 (rawlog/ prefix). 어드민 전용.
 */

const { list } = require('@vercel/blob');
const { verifyToken, apiResponse } = require('../_utils');

function isAdmin(user) {
  return user && user.level === 'admin';
}

/** pathname에서 날짜 추출. rawlog/zeromartrawlog-YYYY-MM-DD.csv → YYYY-MM-DD */
function dateFromPathname(pathname) {
  if (!pathname || typeof pathname !== 'string') return '';
  const match = pathname.match(/zeromartrawlog-(\d{4}-\d{2}-\d{2})\.csv$/);
  return match ? match[1] : '';
}

module.exports = async (req, res) => {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).end();
  }

  try {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return apiResponse(res, 401, { error: '로그인이 필요합니다.' });
    }

    const user = verifyToken(authHeader.substring(7));
    if (!user || !isAdmin(user)) {
      return apiResponse(res, 403, { error: '관리자만 접근할 수 있습니다.' });
    }

    const result = await list({ prefix: 'rawlog/', limit: 500 });
    const blobs = result.blobs || [];
    const items = blobs
      .map((b) => dateFromPathname(b.pathname))
      .filter(Boolean)
      .sort((a, b) => b.localeCompare(a))
      .map((date) => ({ date }));

    return res.status(200).json({ items });
  } catch (e) {
    console.error('List order raw logs error:', e);
    return apiResponse(res, 500, { error: '목록을 불러올 수 없습니다.' });
  }
};
