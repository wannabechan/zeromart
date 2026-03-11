/**
 * 브랜드관리 페이지 - 브랜드 매니저 전용
 * 현재 정산관리 탭만 노출, 기능은 준비 중
 */

const TOKEN_KEY = 'bzcat_token';
const API_BASE = '';

function getToken() {
  return localStorage.getItem(TOKEN_KEY);
}

async function checkBrandManagerAccess() {
  const token = getToken();
  if (!token) {
    window.location.href = '/';
    return;
  }
  try {
    const res = await fetch(`${API_BASE}/api/auth/session`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) {
      window.location.href = '/';
      return;
    }
    const data = await res.json();
    const user = data.user;
    const isAdmin = user && user.level === 'admin';
    const isBrandManager = user && user.isBrandManager;
    if (!isAdmin && !isBrandManager) {
      window.location.href = '/';
    }
  } catch (_) {
    window.location.href = '/';
  }
}

checkBrandManagerAccess();
