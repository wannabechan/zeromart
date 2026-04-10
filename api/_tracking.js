/**
 * 택배 송장 조회 API (스윗트래커 / 스마트택배) — 참고용 모듈
 * 현재 발송 완료 API에서는 호출하지 않으며, 입력한 택배사·송장을 그대로 저장합니다.
 * 나중에 다시 연동할 때 사용할 수 있습니다.
 *
 * 환경 변수: SWEETTRACKER_API_KEY
 * API 키: https://tracking.sweettracker.co.kr/
 */

const TRACKING_API_BASE = 'https://info.sweettracker.co.kr';

/** UI 택배사 이름 → 스윗트래커 t_code (택배사 코드) */
const COURIER_NAME_TO_CODE = {
  'CJ대한통운': '04',
  '한진택배': '05',
  '로젠택배': '08',
  '우체국택배': '01',
  '롯데택배': '06',
  '경동택배': '23',
  '대신택배': '22',
  'CU편의점택배': null,
  '기타': null,
};

/**
 * 송장 번호를 스윗트래커 API로 조회해 유효한지 검증
 * @param {string} courierCompany - 택배사 이름 (예: 한진택배)
 * @param {string} trackingNumber - 송장 번호
 * @returns {Promise<{ valid: boolean, errorMessage?: string }>}
 */
/** 스윗트래커 전달용: 숫자만 추출 (하이픈·공백 등 제거) */
function normalizeTrackingForApi(value) {
  return String(value || '').replace(/\D/g, '');
}

async function validateTrackingWithApi(courierCompany, trackingNumber) {
  const courier = (courierCompany || '').trim();
  const raw = (trackingNumber || '').trim();
  if (!raw) {
    return { valid: false, errorMessage: '송장 번호를 입력해 주세요.' };
  }

  const apiKey = (process.env.SWEETTRACKER_API_KEY || '').trim();
  if (!apiKey) {
    return { valid: true };
  }

  const tCode = COURIER_NAME_TO_CODE[courier];
  if (tCode == null || tCode === '') {
    return { valid: true };
  }

  const tInvoice = normalizeTrackingForApi(raw);
  if (!tInvoice) {
    return { valid: false, errorMessage: '송장 번호를 입력해 주세요.' };
  }

  try {
    const params = new URLSearchParams({
      t_key: apiKey,
      t_code: tCode,
      t_invoice: tInvoice,
    });
    const res = await fetch(`${TRACKING_API_BASE}/api/v1/trackingInfo?${params.toString()}`, {
      method: 'GET',
      headers: { Accept: 'application/json' },
    });

    const body = await res.json().catch(() => ({}));
    if (!res.ok) {
      return { valid: false, errorMessage: '검증 서비스를 일시적으로 사용할 수 없습니다.' };
    }

    if (body.status === true) {
      return { valid: true };
    }
    const msg = (body.msg || '').trim() || '조회된 배송 정보가 없습니다. 송장번호를 확인해 주세요.';
    return { valid: false, errorMessage: msg };
  } catch (err) {
    console.error('SweetTracker API error:', err);
    return { valid: false, errorMessage: '검증 서비스를 일시적으로 사용할 수 없습니다.' };
  }
}

module.exports = { validateTrackingWithApi, normalizeTrackingForApi, COURIER_NAME_TO_CODE };
