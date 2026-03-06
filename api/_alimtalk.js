/**
 * NHN Cloud 알림톡(KakaoTalk Bizmessage) v2.3 치환 발송
 * @see https://docs.nhncloud.com/ko/Notification/KakaoTalk%20Bizmessage/ko/alimtalk-api-guide/
 */

const ALIMTALK_BASE = 'https://api-alimtalk.cloud.toast.com';

/**
 * 수신번호 정규화: 숫자만 추출, 010으로 시작하는 11자리만 허용
 * @param {string} phone
 * @returns {string|null} 11자리 번호 또는 null
 */
function normalizeRecipientNo(phone) {
  const digits = (phone || '').replace(/\D/g, '');
  if (digits.length !== 11 || !digits.startsWith('010')) return null;
  return digits;
}

/**
 * 알림톡 치환 발송
 * @param {object} options
 * @param {string} options.templateCode - 템플릿 코드(콘솔에 등록된 코드)
 * @param {string} options.recipientNo - 수신번호(010xxxxxxxx)
 * @param {Record<string, string>} options.templateParameter - 치환 변수 { '#{변수명}': '값' } 또는 { '변수명': '값' }
 * @returns {Promise<{ success: boolean, requestId?: string, resultCode?: number, resultMessage?: string }>}
 */
async function sendAlimtalk({ templateCode, recipientNo, templateParameter = {} }) {
  const appkey = (process.env.NHN_ALIMTALK_APPKEY || '').trim();
  const secretKey = (process.env.NHN_ALIMTALK_SECRET_KEY || '').trim();
  const senderKey = (process.env.NHN_ALIMTALK_SENDER_KEY || '').trim();

  if (!appkey || !secretKey || !senderKey) {
    console.warn('Alimtalk: NHN_ALIMTALK_APPKEY, NHN_ALIMTALK_SECRET_KEY, NHN_ALIMTALK_SENDER_KEY 중 누락');
    return { success: false, resultMessage: '알림톡 설정이 없습니다.' };
  }

  const normalized = normalizeRecipientNo(recipientNo);
  if (!normalized) {
    const digits = (recipientNo || '').replace(/\D/g, '');
    const masked = digits.length >= 4 ? '***' + digits.slice(-4) : '***';
    console.warn('Alimtalk: 유효하지 않은 수신번호', masked);
    return { success: false, resultMessage: '유효하지 않은 수신번호입니다.' };
  }

  // 템플릿 파라미터: key는 #{} 제거한 변수명(예: storeName), NHN API는 변수명만 사용
  const params = {};
  for (const [k, v] of Object.entries(templateParameter || {})) {
    const key = typeof k === 'string' ? k.replace(/^#?\{?|\}$/g, '') : String(k);
    if (key) params[key] = String(v ?? '');
  }
  if (process.env.NODE_ENV !== 'production') {
    console.log('Alimtalk templateParameter', JSON.stringify(params));
  }

  const body = {
    senderKey,
    templateCode,
    recipientList: [
      {
        recipientNo: normalized,
        templateParameter: params,
      },
    ],
    // 알림톡 실패 시 SMS/LMS 대체 발송(콘솔에서 대체발송·SMS 서비스 설정 필요)
    resendParameter: {
      isResend: true,
    },
  };

  const url = `${ALIMTALK_BASE}/alimtalk/v2.3/appkeys/${encodeURIComponent(appkey)}/messages`;
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json;charset=UTF-8',
      'X-Secret-Key': secretKey,
    },
    body: JSON.stringify(body),
  });

  const data = await res.json().catch(() => ({}));
  const header = data.header || {};
  const isSuccessful = header.isSuccessful === true;

  if (!isSuccessful) {
    const sendResultsStr = data.message?.sendResults != null ? JSON.stringify(data.message.sendResults) : '';
    console.error('Alimtalk send error', header.resultCode, header.resultMessage, sendResultsStr || data);
  }

  return {
    success: isSuccessful,
    requestId: data.message?.requestId,
    resultCode: header.resultCode,
    resultMessage: header.resultMessage || (data.message?.sendResults?.[0]?.resultMessage),
  };
}

module.exports = {
  sendAlimtalk,
  normalizeRecipientNo,
};
