/**
 * Zero Mart 인증 모듈 (API 연동 버전)
 * - 이메일 6자리 코드 로그인, 또는 저장한 비밀번호 로그인
 * - 사용자 레벨: admin(1) | manager(2) | user(3)
 */

const TOKEN_KEY = 'bzcat_token_session';
const LEGACY_TOKEN_KEY = 'bzcat_token';
const API_BASE = ''; // Same origin
const CODE_VALID_SECONDS = 120; // 2분
const PASSWORD_MIN_LENGTH = 8;
const PASSWORD_MAX_LENGTH = 64;

let pendingEmail = null;
let codeCountdownInterval = null;
let setPasswordCountdownInterval = null;
let setPasswordReason = null;

function getToken() {
  let current = localStorage.getItem(TOKEN_KEY);
  if (!current) {
    current = sessionStorage.getItem(TOKEN_KEY);
    if (current) {
      localStorage.setItem(TOKEN_KEY, current);
      sessionStorage.removeItem(TOKEN_KEY);
    }
  }
  if (current) return current;
  const legacy = localStorage.getItem(LEGACY_TOKEN_KEY);
  if (!legacy) return null;
  localStorage.setItem(TOKEN_KEY, legacy);
  localStorage.removeItem(LEGACY_TOKEN_KEY);
  return legacy;
}

function setToken(token) {
  localStorage.setItem(TOKEN_KEY, token);
  sessionStorage.removeItem(TOKEN_KEY);
  localStorage.removeItem(LEGACY_TOKEN_KEY);
}

function clearToken() {
  localStorage.removeItem(TOKEN_KEY);
  sessionStorage.removeItem(TOKEN_KEY);
  localStorage.removeItem(LEGACY_TOKEN_KEY);
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
  const brandManagerLink = document.getElementById('headerBrandManagerLink');
  const storeOrdersLink = document.getElementById('headerStoreOrdersLink');
  const chatBtn = document.getElementById('categoryChatBtn');
  const profileUserEmailEl = document.getElementById('profileUserEmail');
  const isAdmin = user && user.level === 'admin';
  const isBrandManager = user && user.isBrandManager && user.level !== 'admin';
  const isStoreManager = user && user.isStoreManager && user.level !== 'admin';
  if (adminLink) adminLink.style.display = isAdmin ? '' : 'none';
  if (brandManagerLink) brandManagerLink.style.display = !isAdmin && isBrandManager ? '' : 'none';
  if (storeOrdersLink) storeOrdersLink.style.display = !isAdmin && !isBrandManager && isStoreManager ? '' : 'none';
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
  if (user) {
    showApp(user);
  } else {
    showLogin();
  }
  hideInitialLoadOverlay();

  const loginForm = document.getElementById('loginForm');
  const loginEmail = document.getElementById('loginEmail');
  const loginCode = document.getElementById('loginCode');
  const loginCodeSection = document.getElementById('loginCodeSection');
  const loginCodeHint = document.getElementById('loginCodeHint');
  const loginCodeTimer = document.getElementById('loginCodeTimer');
  const loginMethodRow = document.getElementById('loginMethodRow');
  const btnSendCode = document.getElementById('btnSendCode');
  const btnPasswordMode = document.getElementById('btnPasswordMode');
  const loginPasswordSection = document.getElementById('loginPasswordSection');
  const loginPassword = document.getElementById('loginPassword');
  const btnForgotPassword = document.getElementById('btnForgotPassword');
  const setPasswordModal = document.getElementById('setPasswordModal');
  const setPasswordCode = document.getElementById('setPasswordCode');
  const setPasswordTimer = document.getElementById('setPasswordTimer');
  const setPasswordCodeNote = document.getElementById('setPasswordCodeNote');
  const setPasswordNew = document.getElementById('setPasswordNew');
  const setPasswordConfirm = document.getElementById('setPasswordConfirm');
  const setPasswordSubmit = document.getElementById('setPasswordSubmit');
  const setPasswordClose = document.getElementById('setPasswordClose');
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
    const inLoginFlow = loginScreen && loginScreen.style.display !== 'none' && (
      (loginCodeSection && loginCodeSection.style.display !== 'none') ||
      (loginPasswordSection && loginPasswordSection.style.display !== 'none') ||
      (setPasswordModal && setPasswordModal.classList.contains('visible'))
    );
    if (inLoginFlow) {
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

  function stopCodeCountdown() {
    if (codeCountdownInterval) {
      clearInterval(codeCountdownInterval);
      codeCountdownInterval = null;
    }
  }

  function stopSetPasswordCountdown() {
    if (setPasswordCountdownInterval) {
      clearInterval(setPasswordCountdownInterval);
      setPasswordCountdownInterval = null;
    }
  }

  function closeSetPasswordModal() {
    stopSetPasswordCountdown();
    setPasswordReason = null;
    if (setPasswordModal) {
      setPasswordModal.classList.remove('visible');
      setPasswordModal.setAttribute('aria-hidden', 'true');
    }
    if (setPasswordCode) setPasswordCode.value = '';
    if (setPasswordNew) setPasswordNew.value = '';
    if (setPasswordConfirm) setPasswordConfirm.value = '';
    clearSetPasswordFieldErrors();
    if (setPasswordTimer) {
      setPasswordTimer.textContent = '';
      setPasswordTimer.classList.remove('expiring');
    }
    if (setPasswordCodeNote) setPasswordCodeNote.textContent = '';
    if (setPasswordSubmit) {
      setPasswordSubmit.disabled = false;
      setPasswordSubmit.textContent = '확인';
    }
  }

  function showMethodButtons() {
    if (loginMethodRow) loginMethodRow.style.display = '';
    if (btnSendCode) {
      btnSendCode.style.display = '';
      btnSendCode.disabled = false;
      btnSendCode.textContent = '로그인 코드';
    }
    if (btnPasswordMode) {
      btnPasswordMode.style.display = '';
      btnPasswordMode.disabled = false;
    }
  }

  function resetToStep1() {
    stopCodeCountdown();
    closeSetPasswordModal();
    if (loginCodeSection) loginCodeSection.style.display = 'none';
    if (loginPasswordSection) loginPasswordSection.style.display = 'none';
    if (loginCode) loginCode.value = '';
    if (loginPassword) loginPassword.value = '';
    if (loginCodeTimer) {
      loginCodeTimer.textContent = '';
      loginCodeTimer.classList.remove('expiring');
    }
    if (loginCodeHint) loginCodeHint.textContent = '이메일 발송 인증 코드를 입력하세요.';
    pendingEmail = null;
    showMethodButtons();
  }

  function startCountdown(timerEl, onExpire, assignInterval) {
    let remaining = CODE_VALID_SECONDS;
    timerEl.classList.remove('expiring');

    function updateTimer() {
      const min = Math.floor(remaining / 60);
      const sec = remaining % 60;
      timerEl.textContent = `${min}:${String(sec).padStart(2, '0')}`;
      if (remaining <= 30) timerEl.classList.add('expiring');
      else timerEl.classList.remove('expiring');
      if (remaining <= 0) {
        onExpire();
        return;
      }
      remaining--;
    }

    updateTimer();
    assignInterval(setInterval(updateTimer, 1000));
  }

  function startCodeCountdown() {
    stopCodeCountdown();
    startCountdown(loginCodeTimer, () => {
      stopCodeCountdown();
      resetToStep1();
    }, (id) => { codeCountdownInterval = id; });
  }

  function startSetPasswordCountdown() {
    stopSetPasswordCountdown();
    const reason = setPasswordReason;
    startCountdown(setPasswordTimer, () => {
      stopSetPasswordCountdown();
      if (reason === 'setup') resetToStep1();
      else closeSetPasswordModal();
    }, (id) => { setPasswordCountdownInterval = id; });
  }

  function validateEmail(email) {
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test((email || '').trim());
  }

  function passwordRuleError(password) {
    if (typeof password !== 'string' || !password || !password.trim()) return '비밀번호를 입력해 주세요.';
    if (password.length < PASSWORD_MIN_LENGTH || password.length > PASSWORD_MAX_LENGTH) {
      return `비밀번호는 ${PASSWORD_MIN_LENGTH}자 이상 ${PASSWORD_MAX_LENGTH}자 이하여야 합니다.`;
    }
    return null;
  }

  async function finishLogin(data) {
    setToken(data.token);
    pendingEmail = null;
    if (data.isFirstLogin) alert('만나서 반갑습니다!');
    resetToStep1();
    const sessionUser = await checkSession();
    showApp(sessionUser);
    loginForm.reset();
  }

  async function requestAuthCode(email) {
    const response = await fetch(`${API_BASE}/api/auth/send-code`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email }),
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      alert(data.error || '코드 발송에 실패했습니다.');
      return null;
    }
    return data;
  }

  btnSendCode.addEventListener('click', async () => {
    const email = loginEmail.value.trim();
    if (!validateEmail(email)) {
      alert('올바른 이메일 주소를 입력해 주세요.');
      return;
    }

    btnPasswordMode.style.display = 'none';
    btnSendCode.disabled = true;
    btnSendCode.textContent = '발송 중...';

    try {
      const data = await requestAuthCode(email);
      if (!data) {
        showMethodButtons();
        return;
      }

      pendingEmail = email;
      loginMethodRow.style.display = 'none';
      loginPasswordSection.style.display = 'none';
      loginCodeSection.style.display = '';
      loginCode.value = '';
      loginCode.focus();
      startCodeCountdown();
      history.pushState({ loginStep: 'code' }, '', window.location.pathname + (window.location.search || ''));
      loginCodeHint.textContent = data.testAccount
        ? '테스트 계정 고정 인증 코드를 입력하세요.'
        : '이메일 발송 인증 코드를 입력하세요.';
    } catch (error) {
      console.error('Send code error:', error);
      alert('네트워크 오류가 발생했습니다.');
      showMethodButtons();
    }
  });

  async function openSetPasswordModal(reason) {
    if (!pendingEmail || setPasswordModal.classList.contains('visible')) return;
    setPasswordReason = reason;
    setPasswordCode.value = '';
    setPasswordNew.value = '';
    setPasswordConfirm.value = '';
    setPasswordCodeNote.textContent = '';
    setPasswordSubmit.disabled = true;
    setPasswordSubmit.textContent = '발송 중...';
    setPasswordModal.classList.add('visible');
    setPasswordModal.setAttribute('aria-hidden', 'false');

    try {
      const data = await requestAuthCode(pendingEmail);
      if (!data) {
        closeSetPasswordModal();
        if (reason === 'setup') resetToStep1();
        return;
      }
      setPasswordCodeNote.textContent = data.testAccount
        ? '테스트 계정 고정 인증 코드를 입력하세요.'
        : '';
      setPasswordSubmit.disabled = false;
      setPasswordSubmit.textContent = '확인';
      startSetPasswordCountdown();
      setPasswordCode.focus();
    } catch (error) {
      console.error('Set password send code error:', error);
      alert('네트워크 오류가 발생했습니다.');
      closeSetPasswordModal();
      if (reason === 'setup') resetToStep1();
    }
  }

  btnPasswordMode.addEventListener('click', async () => {
    const email = loginEmail.value.trim();
    if (!validateEmail(email)) {
      alert('올바른 이메일 주소를 입력해 주세요.');
      return;
    }

    btnSendCode.style.display = 'none';
    btnPasswordMode.disabled = true;

    try {
      const response = await fetch(`${API_BASE}/api/auth/password-status`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        alert(data.error || '비밀번호 확인에 실패했습니다.');
        showMethodButtons();
        return;
      }

      pendingEmail = email;
      loginMethodRow.style.display = 'none';
      loginCodeSection.style.display = 'none';
      history.pushState({ loginStep: 'password' }, '', window.location.pathname + (window.location.search || ''));
      if (data.hasPassword) {
        loginPasswordSection.style.display = '';
        loginPassword.value = '';
        loginPassword.focus();
      } else {
        await openSetPasswordModal('setup');
      }
    } catch (error) {
      console.error('Password mode error:', error);
      alert('네트워크 오류가 발생했습니다.');
      showMethodButtons();
    }
  });

  btnForgotPassword.addEventListener('click', () => {
    openSetPasswordModal('reset');
  });

  setPasswordClose.addEventListener('click', () => {
    const reason = setPasswordReason;
    closeSetPasswordModal();
    if (reason === 'setup') resetToStep1();
  });

  setPasswordModal.addEventListener('click', (e) => {
    if (e.target !== setPasswordModal) return;
    const reason = setPasswordReason;
    closeSetPasswordModal();
    if (reason === 'setup') resetToStep1();
  });

  function setPasswordFieldError(input, message) {
    const shell = input && input.closest('.login-input-shell');
    const err = shell && shell.querySelector('.login-input-inline-error');
    if (!shell || !err) return;
    if (!message) {
      shell.classList.remove('has-error');
      err.textContent = '';
      input.removeAttribute('aria-invalid');
      return;
    }
    shell.classList.add('has-error');
    err.textContent = message;
    input.setAttribute('aria-invalid', 'true');
  }

  function clearSetPasswordFieldErrors() {
    setPasswordFieldError(setPasswordCode, '');
    setPasswordFieldError(setPasswordNew, '');
    setPasswordFieldError(setPasswordConfirm, '');
  }

  function collectSetPasswordFieldErrors(code, password, passwordConfirm) {
    const errors = { code: '', password: '', confirm: '' };
    const codeTrim = (code || '').trim();
    const codeDigits = codeTrim.replace(/\D/g, '');
    if (!codeTrim) errors.code = '필수 입력 사항입니다.';
    else if (codeDigits.length !== 6 || codeDigits !== codeTrim) errors.code = '틀린 코드입니다.';

    if (!password || !String(password).trim()) errors.password = '필수 입력 사항입니다.';
    else if (password.length < PASSWORD_MIN_LENGTH) errors.password = '8자리 이상 입력하세요.';
    else if (password.length > PASSWORD_MAX_LENGTH) errors.password = '64자 이하로 입력하세요.';

    if (!passwordConfirm || !String(passwordConfirm).trim()) errors.confirm = '필수 입력 사항입니다.';
    else if (password !== passwordConfirm) errors.confirm = '입력 내용이 다릅니다.';
    return errors;
  }

  function showSetPasswordFieldErrors(errors) {
    setPasswordFieldError(setPasswordCode, errors.code);
    setPasswordFieldError(setPasswordNew, errors.password);
    setPasswordFieldError(setPasswordConfirm, errors.confirm);
  }

  function setPasswordServerFieldError(status, message) {
    const msg = String(message || '');
    clearSetPasswordFieldErrors();
    if (status === 429 || msg.includes('너무 많')) {
      setPasswordFieldError(setPasswordCode, '잠시 후 다시 하세요.');
      return;
    }
    if (msg.includes('일치')) {
      setPasswordFieldError(setPasswordConfirm, '입력 내용이 다릅니다.');
      return;
    }
    if (msg.includes('코드') || msg.includes('만료')) {
      setPasswordFieldError(setPasswordCode, '틀린 코드입니다.');
      return;
    }
    if (msg.includes('이메일')) {
      setPasswordFieldError(setPasswordCode, '이메일을 확인하세요.');
      return;
    }
    if (msg.includes('8자') || msg.includes('64자') || msg.includes('이상')) {
      const tooLong = (setPasswordNew.value || '').length > PASSWORD_MAX_LENGTH;
      setPasswordFieldError(setPasswordNew, tooLong ? '64자 이하로 입력하세요.' : '8자리 이상 입력하세요.');
      return;
    }
    setPasswordFieldError(setPasswordCode, status >= 500 ? '서버 오류입니다.' : '저장에 실패했습니다.');
  }

  [setPasswordCode, setPasswordNew, setPasswordConfirm].forEach((input) => {
    input.addEventListener('input', () => setPasswordFieldError(input, ''));
  });

  setPasswordSubmit.addEventListener('click', async () => {
    const code = setPasswordCode.value || '';
    const password = setPasswordNew.value || '';
    const passwordConfirm = setPasswordConfirm.value || '';
    const errors = collectSetPasswordFieldErrors(code, password, passwordConfirm);
    if (errors.code || errors.password || errors.confirm) {
      showSetPasswordFieldErrors(errors);
      return;
    }
    if (!pendingEmail) {
      setPasswordFieldError(setPasswordCode, '이메일을 확인하세요.');
      return;
    }

    setPasswordSubmit.disabled = true;
    setPasswordSubmit.textContent = '저장 중...';
    try {
      const response = await fetch(`${API_BASE}/api/auth/set-password`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: pendingEmail,
          code: code.trim(),
          password,
          passwordConfirm,
        }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        setPasswordServerFieldError(response.status, data.error);
        setPasswordSubmit.disabled = false;
        setPasswordSubmit.textContent = '확인';
        return;
      }
      await finishLogin(data);
    } catch (error) {
      console.error('Set password error:', error);
      clearSetPasswordFieldErrors();
      setPasswordFieldError(setPasswordCode, '네트워크 오류입니다.');
      setPasswordSubmit.disabled = false;
      setPasswordSubmit.textContent = '확인';
    }
  });

  async function submitPasswordLogin() {
    const password = loginPassword.value || '';
    const rule = passwordRuleError(password);
    if (rule) {
      alert(rule);
      return;
    }
    if (!pendingEmail) {
      alert('이메일을 입력해 주세요.');
      return;
    }
    try {
      const response = await fetch(`${API_BASE}/api/auth/login-password`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: pendingEmail, password }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        alert(data.error || '로그인에 실패했습니다.');
        return;
      }
      await finishLogin(data);
    } catch (error) {
      console.error('Password login error:', error);
      alert('네트워크 오류가 발생했습니다.');
    }
  }

  async function submitCodeLogin() {
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
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: pendingEmail, code }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        alert(data.error || '인증에 실패했습니다.');
        return;
      }
      await finishLogin(data);
    } catch (error) {
      console.error('Verify code error:', error);
      alert('네트워크 오류가 발생했습니다.');
    }
  }

  loginForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (loginPasswordSection.style.display !== 'none') {
      await submitPasswordLogin();
      return;
    }
    if (loginCodeSection.style.display === 'none') return;
    await submitCodeLogin();
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
