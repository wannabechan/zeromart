/**
 * 택배 송장 조회 API 연동 (스윗트래커 / 스마트택배 API)
 * 발송 처리 시 송장 번호가 택배사 시스템에 실제 존재하는지 검증
 *
 * 환경 변수 (선택): SWEETTRACKER_API_KEY
 * - 설정 시: CJ/한진/로젠/우체국 등 지원 택배사 송장은 API로 유효성 검증 후 저장
 * - 미설정 시: 검증 없이 저장 (기존 동작)
 * - CU편의점택배·기타 등 미지원 택배사는 검증 생략 후 저장
 *
 * API 키 발급: https://tracking.sweettracker.co.kr/ 회원가입 후 조회 API 키 발급
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
async function validateTrackingWithApi(courierCompany, trackingNumber) {
  const courier = (courierCompany || '').trim();
  const tracking = (trackingNumber || '').trim();
  if (!tracking) {
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

  try {
    const params = new URLSearchParams({
      t_key: apiKey,
      t_code: tCode,
      t_invoice: tracking,
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

module.exports = { validateTrackingWithApi, COURIER_NAME_TO_CODE };
