/**
 * GET /api/admin/resend-logs
 * Resend 발송 메타 로그 (관리자 전용, 최근 30일, 상한 500건)
 * — Redis 앱 로그와 Resend List Emails API 결과를 병합해, Resend에 기록된 발송도 표시합니다.
 */

const { verifyToken, apiResponse } = require('../_utils');
const { getMergedResendLogsForAdmin } = require('../_resendMerge');

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

    const { logs, resendListSync, resendListSyncMessage } = await getMergedResendLogsForAdmin();
    return apiResponse(res, 200, {
      logs,
      resendListSync,
      resendListSyncMessage: resendListSyncMessage || null,
    });
  } catch (e) {
    console.error('resend-logs:', e);
    return apiResponse(res, 500, { error: '목록을 불러오지 못했습니다.' });
  }
};
