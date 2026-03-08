/**
 * KST(한국 표준시) 기준 날짜/시간 유틸
 * 모든 날짜 비교·그룹핑·표시는 이 모듈을 통해 KST로 통일한다.
 */

const KST_OFFSET_MS = 9 * 60 * 60 * 1000;

/**
 * ISO 문자열 또는 타임스탬프를 KST 기준 날짜 키(YYYY-MM-DD)로 변환
 * @param {string|number|Date} isoOrDate - created_at 등
 * @returns {string} 'YYYY-MM-DD' (KST)
 */
function toKSTDateKey(isoOrDate) {
  if (isoOrDate == null || isoOrDate === '') return '';
  const d = new Date(isoOrDate);
  const ts = d.getTime();
  if (Number.isNaN(ts)) return '';
  const kst = new Date(ts + KST_OFFSET_MS);
  const y = kst.getUTCFullYear();
  const m = String(kst.getUTCMonth() + 1).padStart(2, '0');
  const day = String(kst.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/**
 * YYYY-MM-DD(해당일 KST)의 00:00:00.000 ~ 23:59:59.999 KST를 UTC ms로 반환
 * @param {string} dateStr - 'YYYY-MM-DD'
 * @returns {{ startMs: number, endMs: number }}
 */
function getKSTDayRange(dateStr) {
  if (!dateStr || typeof dateStr !== 'string') return { startMs: 0, endMs: 0 };
  const startMs = new Date(dateStr + 'T00:00:00.000+09:00').getTime();
  const endMs = new Date(dateStr + 'T23:59:59.999+09:00').getTime();
  return { startMs, endMs };
}

/**
 * 현재 시점의 KST 기준 날짜 키(YYYY-MM-DD)
 * @returns {string}
 */
function getTodayKSTDateKey() {
  const now = Date.now();
  return toKSTDateKey(now);
}

module.exports = {
  KST_OFFSET_MS,
  toKSTDateKey,
  getKSTDayRange,
  getTodayKSTDateKey,
};
