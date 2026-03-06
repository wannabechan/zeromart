/**
 * BzCat 인증 모듈 (API 연동 버전)
 * - 이메일 기반 6자리 코드 로그인
 * - 사용자 레벨: admin(1) | manager(2) | user(3)
 */

const TOKEN_KEY = 'bzcat_token';
const API_BASE = ''; // Same origin
const CODE_VALID_SECONDS = 120; // 2분

let pendingEmail = null;
let codeCountdownInterval = null;

function getToken() {
  return localStorage.getItem(TOKEN_KEY);
}

function setToken(token) {
  localStorage.setItem(TOKEN_KEY, token);
}

function clearToken() {
  localStorage.removeItem(TOKEN_KEY);
  pendingEmail = null;
}

async function checkSession() {
  const token = getToken();
  if (!token) return null;

  try {
    const response = await fetch(`${API_BASE}/api/auth/session`, {
      headers: {
        'Authorization': `Bearer ${token}`,
      },
    });

    if (!response.ok) {
      clearToken();
      return null;
    }

    const data = await response.json();
    return data.user;
  } catch (error) {
    console.error('Session check error:', error);
    clearToken();
    return null;
  }
}

function showLogin() {
  document.getElementById('loginScreen').style.display = 'flex';
  document.getElementById('mainApp').style.display = 'none';
}

function showApp(user) {
  document.getElementById('loginScreen').style.display = 'none';
  document.getElementById('mainApp').style.display = 'flex';
  const adminLink = document.getElementById('headerAdminLink');
  const storeOrdersLink = document.getElementById('headerStoreOrdersLink');
  const chatBtn = document.getElementById('categoryChatBtn');
  const profileUserEmailEl = document.getElementById('profileUserEmail');
  const isAdmin = user && user.level === 'admin';
  const isStoreManager = user && user.isStoreManager && user.level !== 'admin';
  if (adminLink) adminLink.style.display = isAdmin ? '' : 'none';
  if (storeOrdersLink) storeOrdersLink.style.display = isStoreManager ? '' : 'none';
  if (profileUserEmailEl) profileUserEmailEl.textContent = user && user.email ? user.email : '';
  // 채팅 버튼: 기능 기획 후 다시 살리기 → if (chatBtn) chatBtn.style.display = isAdmin ? '' : 'none';
  if (chatBtn) chatBtn.style.display = 'none';
  const profileToggle = document.getElementById('profileToggle');
  const cartToggle = document.getElementById('cartToggle');
  const headerLoginBtn = document.getElementById('headerLoginBtn');
  if (user) {
    if (profileToggle) profileToggle.style.display = '';
    if (cartToggle) cartToggle.style.display = '';
    if (headerLoginBtn) headerLoginBtn.style.display = 'none';
  } else {
    if (profileToggle) profileToggle.style.display = 'none';
    if (cartToggle) cartToggle.style.display = 'none';
    if (headerLoginBtn) headerLoginBtn.style.display = '';
  }
  // 신규 로그인 시 기본 화면으로: 내 주문 보기 드로어 닫기 (단, #orders/#profile 링크로 들어온 경우에는 드로어 열기)
  const hash = (window.location.hash || '').toLowerCase();
  if (hash === '#orders' || hash === '#profile') {
    if (typeof window.BzCatAppOpenProfile === 'function') window.BzCatAppOpenProfile();
  } else {
    const profileDrawer = document.getElementById('profileDrawer');
    const profileOverlay = document.getElementById('profileOverlay');
    if (profileDrawer) profileDrawer.classList.remove('open');
    if (profileOverlay) {
      profileOverlay.classList.remove('visible');
      profileOverlay.setAttribute('aria-hidden', 'true');
    }
    document.body.style.overflow = '';
  }
  if (typeof window.BzCatAppOnShow === 'function') window.BzCatAppOnShow();
}

function hideInitialLoadOverlay() {
  const overlay = document.getElementById('initialLoadOverlay');
  if (overlay) {
    overlay.setAttribute('aria-hidden', 'true');
    overlay.style.display = 'none';
  }
}

async function initAuth() {
  const user = await checkSession();
  showApp(user);
  hideInitialLoadOverlay();

  const loginForm = document.getElementById('loginForm');
  const loginEmail = document.getElementById('loginEmail');
  const loginCode = document.getElementById('loginCode');
  const loginCodeSection = document.getElementById('loginCodeSection');
  const loginCodeHint = document.getElementById('loginCodeHint');
  const loginCodeTimer = document.getElementById('loginCodeTimer');
  const btnSendCode = document.getElementById('btnSendCode');
  const btnLogout = document.getElementById('btnLogout');
  const loginLogo = document.getElementById('loginLogo');

  const loginScreen = document.getElementById('loginScreen');

  if (loginLogo) {
    loginLogo.addEventListener('click', () => location.reload());
    loginLogo.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        location.reload();
      }
    });
  }

  window.addEventListener('popstate', async () => {
    if (loginScreen && loginScreen.style.display !== 'none' && loginCodeSection && loginCodeSection.style.display !== 'none') {
      resetToStep1();
      return;
    }
    const user = await checkSession();
    showApp(user);
  });

  window.addEventListener('pageshow', async (event) => {
    if (event.persisted) {
      const user = await checkSession();
      showApp(user);
    }
  });

  function resetToStep1() {
    if (codeCountdownInterval) {
      clearInterval(codeCountdownInterval);
      codeCountdownInterval = null;
    }
    loginCodeSection.style.display = 'none';
    loginCode.value = '';
    loginCodeTimer.textContent = '';
    loginCodeTimer.classList.remove('expiring');
    loginCodeHint.textContent = '이메일로 발송된 인증 코드를 입력하세요.';
    pendingEmail = null;
    btnSendCode.style.display = '';
    btnSendCode.disabled = false;
    btnSendCode.textContent = '로그인 코드 생성';
  }

  function startCodeCountdown() {
    let remaining = CODE_VALID_SECONDS;
    loginCodeTimer.classList.remove('expiring');

    function updateTimer() {
      const min = Math.floor(remaining / 60);
      const sec = remaining % 60;
      loginCodeTimer.textContent = `${min}:${String(sec).padStart(2, '0')}`;
      if (remaining <= 30) {
        loginCodeTimer.classList.add('expiring');
      } else {
        loginCodeTimer.classList.remove('expiring');
      }
      if (remaining <= 0) {
        clearInterval(codeCountdownInterval);
        codeCountdownInterval = null;
        resetToStep1();
        return;
      }
      remaining--;
    }

    updateTimer();
    codeCountdownInterval = setInterval(updateTimer, 1000);
  }

  function validateEmail(email) {
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test((email || '').trim());
  }

  btnSendCode.addEventListener('click', async () => {
    const email = loginEmail.value.trim();
    if (!validateEmail(email)) {
      alert('올바른 이메일 주소를 입력해 주세요.');
      return;
    }

    btnSendCode.disabled = true;
    btnSendCode.textContent = '발송 중...';

    try {
      const response = await fetch(`${API_BASE}/api/auth/send-code`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ email }),
      });

      const data = await response.json();

      if (!response.ok) {
        alert(data.error || '코드 발송에 실패했습니다.');
        return;
      }

      pendingEmail = email;
      loginCodeSection.style.display = '';
      loginCode.value = '';
      loginCode.focus();
      btnSendCode.style.display = 'none';
      startCodeCountdown();
      history.pushState({ loginStep: 'code' }, '', window.location.pathname + (window.location.search || ''));

      // 개발 모드: 코드 표시 (textContent로 넣어 XSS 방지)
      loginCodeHint.textContent = '';
      loginCodeHint.appendChild(document.createTextNode('이메일로 발송된 인증 코드를 입력하세요.'));
      if (data.devCode) {
        const devSpan = document.createElement('span');
        devSpan.className = 'login-dev-code';
        devSpan.textContent = ` [개발] 코드: ${data.devCode}`;
        loginCodeHint.appendChild(devSpan);
      }

    } catch (error) {
      console.error('Send code error:', error);
      alert('네트워크 오류가 발생했습니다.');
      btnSendCode.disabled = false;
      btnSendCode.textContent = '로그인 코드 생성';
    }
  });

  loginForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const code = (loginCode.value || '').trim();
    
    if (!code || code.length !== 6) {
      alert('6자리 인증 코드를 입력해 주세요.');
      return;
    }
    
    if (!pendingEmail) {
      alert('먼저 로그인 코드를 생성해 주세요.');
      return;
    }

    try {
      const response = await fetch(`${API_BASE}/api/auth/verify-code`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          email: pendingEmail,
          code: code,
        }),
      });

      const data = await response.json();

      if (!response.ok) {
        alert(data.error || '인증에 실패했습니다.');
        return;
      }

      // 토큰 저장
      setToken(data.token);
      pendingEmail = null;

      // 첫 로그인 환영 메시지
      if (data.isFirstLogin) {
        alert('만나서 반갑습니다. 맛있게 준비해드릴게요!');
      }

      // 세션에서 isStoreManager 등 전체 사용자 정보를 받아 앱 표시
      resetToStep1();
      const sessionUser = await checkSession();
      showApp(sessionUser);
      loginForm.reset();

    } catch (error) {
      console.error('Verify code error:', error);
      alert('네트워크 오류가 발생했습니다.');
    }
  });

  const profileHamburgerBtn = document.getElementById('profileHamburgerBtn');
  const profileMenuPanel = document.getElementById('profileMenuPanel');
  const profileMenuEmail = document.getElementById('profileMenuEmail');
  const profileMenuInquiry = document.getElementById('profileMenuInquiry');

  if (profileHamburgerBtn && profileMenuPanel) {
    profileHamburgerBtn.addEventListener('click', () => {
      const isOpen = profileMenuPanel.classList.toggle('open');
      profileHamburgerBtn.setAttribute('aria-expanded', isOpen ? 'true' : 'false');
      profileMenuPanel.setAttribute('aria-hidden', isOpen ? 'false' : 'true');
      if (isOpen) {
        profileMenuPanel.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'nearest' });
        if (profileMenuEmail && !profileMenuEmail.textContent) {
          fetch('/api/config')
            .then((r) => r.json())
            .then((data) => {
              const email = (data && data.emailAdmin) ? String(data.emailAdmin).trim() : '';
              profileMenuEmail.textContent = email || '';
              if (profileMenuInquiry) {
                profileMenuInquiry.href = email ? `mailto:${email}` : '#';
                if (!email) profileMenuInquiry.removeAttribute('href');
              }
            })
            .catch(() => {
              if (profileMenuInquiry) profileMenuInquiry.href = '#';
            });
        }
      }
    });
  }

  if (profileMenuPanel) {
    document.addEventListener('click', (e) => {
      if (!profileMenuPanel.classList.contains('open')) return;
      if (profileHamburgerBtn && profileHamburgerBtn.contains(e.target)) return;
      if (profileMenuPanel.contains(e.target)) return;
      profileMenuPanel.classList.remove('open');
      profileMenuPanel.setAttribute('aria-hidden', 'true');
      if (profileHamburgerBtn) profileHamburgerBtn.setAttribute('aria-expanded', 'false');
    });
  }

  if (btnLogout) {
    btnLogout.addEventListener('click', () => {
      if (profileMenuPanel) {
        profileMenuPanel.classList.remove('open');
        profileMenuPanel.setAttribute('aria-hidden', 'true');
        if (profileHamburgerBtn) profileHamburgerBtn.setAttribute('aria-expanded', 'false');
      }
      clearToken();
      resetToStep1();
      showApp(null);
      if (loginForm) loginForm.reset();
    });
  }

  if (profileMenuInquiry) {
    profileMenuInquiry.addEventListener('click', () => {
      if (profileMenuPanel) {
        profileMenuPanel.classList.remove('open');
        profileMenuPanel.setAttribute('aria-hidden', 'true');
        if (profileHamburgerBtn) profileHamburgerBtn.setAttribute('aria-expanded', 'false');
      }
    });
  }

  document.querySelectorAll('.profile-menu-terms-link').forEach((el) => {
    el.addEventListener('click', () => {
      if (profileMenuPanel) {
        profileMenuPanel.classList.remove('open');
        profileMenuPanel.setAttribute('aria-hidden', 'true');
        if (profileHamburgerBtn) profileHamburgerBtn.setAttribute('aria-expanded', 'false');
      }
    });
  });

  const headerLoginBtn = document.getElementById('headerLoginBtn');
  if (headerLoginBtn) {
    headerLoginBtn.addEventListener('click', () => {
      showLogin();
    });
  }
}

// Export for use in app.js
window.BzCatAuth = {
  getToken,
  checkSession,
  showLogin,
};

document.addEventListener('DOMContentLoaded', initAuth);
