/**
 * GET /api/admin/download-order-raw-log?date=YYYY-MM-DD
 * 주문 원시 로그 CSV 다운로드 (어드민 전용). Blob은 private 저장.
 */

const { get } = require('@vercel/blob');
const { Readable } = require('stream');
const { verifyToken, apiResponse, isAdmin } = require('../_utils');

function pickQuery(req, key) {
  const q = req.query || {};
  const v = q[key] ?? q[key.toLowerCase()];
  return Array.isArray(v) ? v[0] : v;
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

    const dateParam = (pickQuery(req, 'date') || '').trim();
    if (!dateParam || !/^\d{4}-\d{2}-\d{2}$/.test(dateParam)) {
      return apiResponse(res, 400, { error: 'date 파라미터가 필요합니다. (YYYY-MM-DD)' });
    }

    const pathname = `rawlog/zeromartrawlog-${dateParam}.csv`;
    const result = await get(pathname, { access: 'private' });

    if (!result || (result.statusCode !== undefined && result.statusCode !== 200)) {
      return apiResponse(res, 404, { error: '해당 날짜의 로그 파일이 없습니다.' });
    }

    const stream = result.stream != null ? Readable.fromWeb(result.stream) : null;
    if (!stream) {
      return apiResponse(res, 404, { error: '해당 날짜의 로그 파일이 없습니다.' });
    }

    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="zeromartrawlog-${dateParam}.csv"`);
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Cache-Control', 'private, no-store');
    stream.pipe(res);
  } catch (e) {
    console.error('Download order raw log error:', e);
    const is404 = e.statusCode === 404 || (e.message && /not found|404/i.test(e.message));
    return apiResponse(res, is404 ? 404 : 500, {
      error: is404 ? '해당 날짜의 로그 파일이 없습니다.' : (e.message || '다운로드에 실패했습니다.'),
    });
  }
};
