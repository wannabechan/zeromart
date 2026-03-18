/**
 * Admin 페이지 - 매장·메뉴·결제정보 관리
 */

const TOKEN_KEY = 'bzcat_token';
const API_BASE = '';
const FETCH_TIMEOUT_MS = 15000;
const ADMIN_TAB_KEY = 'bzcat_admin_tab';

let adminPaymentOrders = [];
let adminPaymentTotal = 0;
let adminPaymentSortBy = 'created_at';
let adminPaymentSortDir = { created_at: 'desc' };
let adminPaymentSubFilter = 'delivery_wait'; // 'new' | 'delivery_wait' | 'delivery_completed' | 'cancelled'
/** 주문관리 기간: 'this_month' | '1_month' | '3_months'. API에 startDate(YYYY-MM-DD)로 전달 */
let adminPaymentPeriod = 'this_month';
let adminStoresMap = {};
let adminStoreOrder = []; // slug order for order detail
let adminStatsLastData = null;
let adminStatsMenuFilter = 'top10'; // 'top10' | 'all'

const PAYMENT_IDLE_MS = 180000; // 180초 무활동 시 주문 목록 리프레시
let paymentIdleTimerId = null;
let paymentIdleListenersAttached = false;
let adminPaymentFlashIntervals = [];
let adminDeliveryModalOrderId = null;
let adminEmailFromServer = '';
/** 매장관리 그룹명(suburl) 목록 - 콤보박스 옵션 및 새 그룹 추가 시 갱신 */
let adminGroupNames = [];

function getAdminLoadingHtml() {
  return '<div class="admin-loading" role="status" aria-label="로딩 중" data-loading-start="' + Date.now() + '"><div class="admin-loading-progress"><div class="admin-loading-progress-bar"></div></div><span class="admin-loading-progress-pct">0%</span></div>';
}

function getAdminPeriodBarOnlyHtml() {
  const periodStartDate = getPaymentStartDateForPeriod(adminPaymentPeriod);
  return (
    '<div class="admin-payment-sort">' +
    '<div class="admin-payment-period-btns">' +
    '<button type="button" class="admin-payment-sort-btn admin-payment-period-btn ' + (adminPaymentPeriod === 'this_month' ? 'active' : '') + '" data-period="this_month">이번달</button><span class="admin-payment-period-gap">&nbsp;</span>' +
    '<button type="button" class="admin-payment-sort-btn admin-payment-period-btn ' + (adminPaymentPeriod === '1_month' ? 'active' : '') + '" data-period="1_month">1개월전부터</button><span class="admin-payment-period-gap">&nbsp;</span>' +
    '<button type="button" class="admin-payment-sort-btn admin-payment-period-btn ' + (adminPaymentPeriod === '3_months' ? 'active' : '') + '" data-period="3_months">3개월전부터</button>' +
    '</div>' +
    '<div class="admin-payment-period-range">>> ' + escapeHtml(periodStartDate) + ' ~ 현재</div>' +
    '</div>'
  );
}

function attachAdminPeriodListeners(container) {
  if (!container) return;
  container.querySelectorAll('[data-period]').forEach(function (btn) {
    btn.addEventListener('click', function () {
      const period = btn.dataset.period;
      if (period && adminPaymentPeriod !== period) {
        adminPaymentPeriod = period;
        loadPaymentManagement();
      }
    });
  });
}

// 이미지 규칙: 1:1 비율, 권장 400x400px
const IMAGE_RULE = '가로·세로 1:1 비율, 권장 400×400px';

const BUSINESS_HOURS_SLOTS = ['09:00-10:00', '10:00-11:00', '11:00-12:00', '12:00-13:00', '13:00-14:00', '14:00-15:00', '15:00-16:00', '16:00-17:00', '17:00-18:00', '18:00-19:00', '19:00-20:00', '20:00-21:00'];

/** 정산관리 탭: true면 목 데이터, false면 실제 API/DB 기준 */
const SETTLEMENT_MOCK_FOR_TEST = false;
/** 정산관리 탭 UI 확인용 샘플 데이터. true면 실제 API/DB 대신 프론트에서만 가상 데이터 표시. 테스트 후 실제 데이터로 전환 시 false 로 변경. */
const SETTLEMENT_SAMPLE_DATA = false;

function getToken() {
  return localStorage.getItem(TOKEN_KEY);
}

function getOrderNumberDisplay(order) {
  const id = order?.id ?? '';
  const items = order?.order_items || order?.orderItems || [];
  const slugs = [...new Set(items.map((i) => ((i.id || '').toString().split('-')[0] || '').toLowerCase()).filter(Boolean))];
  slugs.sort();
  const n = slugs.length || 1;
  if (n <= 1) return `#${id}-1`;
  return slugs.map((_, i) => `#${id}-${i + 1}`).join(', ');
}

function escapeHtml(s) {
  if (s == null || s === '') return '';
  const t = String(s);
  return t.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

/** img src에 쓸 수 있는 URL만 허용 (http/https 또는 / 로 시작) */
function safeImageUrl(url) {
  const u = (url || '').trim();
  if (!u) return '';
  const lower = u.toLowerCase();
  if (lower.startsWith('https://') || lower.startsWith('http://') || u.startsWith('/')) return u;
  return '';
}

function fetchWithTimeout(url, options, timeoutMs) {
  const ctrl = new AbortController();
  const id = setTimeout(() => ctrl.abort(), timeoutMs || FETCH_TIMEOUT_MS);
  return fetch(url, { ...options, signal: ctrl.signal }).finally(() => clearTimeout(id));
}

async function checkAdmin() {
  const token = getToken();
  if (!token) return { ok: false, error: '로그인이 필요합니다.' };
  try {
    const res = await fetchWithTimeout(`${API_BASE}/api/auth/session`, {
      headers: { 'Authorization': `Bearer ${token}` },
    });
    if (!res.ok) return { ok: false, error: '세션이 만료되었습니다.' };
    const data = await res.json();
    const isAdmin = data.user?.level === 'admin';
    return { ok: isAdmin, error: isAdmin ? null : '관리자만 접근할 수 있습니다.' };
  } catch (e) {
    return { ok: false, error: e.name === 'AbortError' ? '요청 시간이 초과되었습니다.' : (e.message || '연결에 실패했습니다.') };
  }
}

async function fetchStores() {
  const token = getToken();
  try {
    const res = await fetchWithTimeout(`${API_BASE}/api/admin/stores`, {
      headers: { 'Authorization': `Bearer ${token}` },
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error || '데이터를 불러올 수 없습니다.');
    }
    const data = await res.json();
    if (data && data.adminEmail !== undefined) adminEmailFromServer = data.adminEmail || '';
    return data;
  } catch (e) {
    if (e.name === 'AbortError') throw new Error('요청 시간이 초과되었습니다. 네트워크를 확인하고 다시 시도해 주세요.');
    throw e;
  }
}

async function saveStores(stores, menus) {
  const token = getToken();
  const res = await fetch(`${API_BASE}/api/admin/stores`, {
    method: 'PUT',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${token}`,
    },
    body: JSON.stringify({ stores, menus }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || '저장에 실패했습니다.');
  }
}

async function patchStoreAllowedEmails(storeId, email, action, type) {
  const token = getToken();
  const body = { storeId, email: email.trim().toLowerCase(), action };
  if (type === 'manager') body.type = 'manager';
  const res = await fetch(`${API_BASE}/api/admin/stores`, {
    method: 'PATCH',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${token}`,
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || '처리에 실패했습니다.');
  }
}

const MASTER_MANAGER_EMAIL = 'zeromartmanager@gmail.com';

async function loadStoresView() {
  const content = document.getElementById('adminContent');
  if (!content) return;
  try {
    const { stores, menus } = await fetchStores();
    adminGroupNames = [...new Set(stores.map((s) => (s.suburl || '').trim()).filter(Boolean))].sort((a, b) => String(a).localeCompare(b, 'ko'));
    const indexHtml = stores.length > 1
      ? `<div class="admin-index">
          <span class="admin-index-label">바로가기</span>
          <div class="admin-index-btns">
            ${stores.map((s) => `<button type="button" class="admin-btn admin-btn-index" data-goto-store="${escapeHtml(s.id || '')}">${escapeHtml(s.title || s.id || '')}</button>`).join('')}
          </div>
        </div>`
      : '';
    content.innerHTML = `
      ${indexHtml}
      <div class="admin-stores-list" id="adminStoresList">
        ${stores.map((s) => renderStore({ ...s, registered: true }, menus[s.id] || [], adminGroupNames)).join('')}
      </div>
      <div class="admin-add-store-row">
        <button type="button" class="admin-btn admin-btn-secondary admin-btn-add-store" data-add-store>+ 카테고리 추가</button>
        <button type="button" class="admin-btn admin-btn-reorder-stores" data-reorder-stores aria-label="카테고리 순서 변경" title="카테고리 순서 변경"><span class="admin-reorder-icon" aria-hidden="true">↕</span></button>
      </div>
    `;
  } catch (e) {
    content.innerHTML = '<div class="admin-loading">로딩에 실패했습니다.</div>';
    showError(e.message);
  }
}

function openPermissionsAddModal(storeId, type) {
  const modal = document.getElementById('adminPermissionsAddModal');
  const textarea = document.getElementById('adminPermissionsAddTextarea');
  if (!modal || !textarea) return;
  modal.dataset.storeId = storeId || '';
  modal.dataset.permType = type === 'manager' ? 'manager' : 'allowed';
  textarea.value = '';
  modal.classList.add('admin-modal-visible');
  modal.setAttribute('aria-hidden', 'false');
  textarea.focus();
}

function closePermissionsAddModal() {
  const modal = document.getElementById('adminPermissionsAddModal');
  if (modal) {
    modal.classList.remove('admin-modal-visible');
    modal.setAttribute('aria-hidden', 'true');
  }
}

function openPermissionsRemoveModal(storeId, email, type) {
  const modal = document.getElementById('adminPermissionsRemoveModal');
  const msgEl = document.getElementById('adminPermissionsRemoveMessage');
  const emailEl = document.getElementById('adminPermissionsRemoveEmail');
  if (!modal) return;
  modal.dataset.storeId = storeId || '';
  modal.dataset.email = email || '';
  modal.dataset.permType = type === 'manager' ? 'manager' : 'allowed';
  if (msgEl) msgEl.textContent = '이용 권한을 삭제하시겠습니까?';
  if (emailEl) emailEl.textContent = email || '';
  modal.classList.add('admin-modal-visible');
  modal.setAttribute('aria-hidden', 'false');
}

function closePermissionsRemoveModal() {
  const modal = document.getElementById('adminPermissionsRemoveModal');
  if (modal) {
    modal.classList.remove('admin-modal-visible');
    modal.setAttribute('aria-hidden', 'true');
  }
}

function initPermissionsModalsOnce() {
  if (window._permissionsModalsInited) return;
  window._permissionsModalsInited = true;

  const addModal = document.getElementById('adminPermissionsAddModal');
  const addClose = document.getElementById('adminPermissionsAddModalClose');
  const addCancel = document.getElementById('adminPermissionsAddCancel');
  const addSubmit = document.getElementById('adminPermissionsAddSubmit');
  const addTextarea = document.getElementById('adminPermissionsAddTextarea');

  if (addClose) addClose.addEventListener('click', closePermissionsAddModal);
  if (addCancel) addCancel.addEventListener('click', closePermissionsAddModal);
  if (addSubmit) {
    addSubmit.addEventListener('click', async () => {
      const storeId = addModal && addModal.dataset.storeId;
      const permType = addModal && addModal.dataset.permType ? addModal.dataset.permType : 'allowed';
      if (!storeId) return;
      const raw = (addTextarea && addTextarea.value) || '';
      const lines = raw.split(/\r?\n/).map((line) => line.split(/[,;\s]+/).map((s) => s.trim().toLowerCase()).filter(Boolean)).flat();
      const emails = [...new Set(lines)].filter((e) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e));
      if (emails.length === 0) {
        alert('올바른 이메일을 한 줄에 하나씩 입력해 주세요.');
        return;
      }
      addSubmit.disabled = true;
      try {
        for (const email of emails) {
          await patchStoreAllowedEmails(storeId, email, 'add', permType === 'manager' ? 'manager' : undefined);
        }
        closePermissionsAddModal();
        loadPermissionsView();
      } catch (e) {
        alert(e.message || '추가에 실패했습니다.');
      } finally {
        addSubmit.disabled = false;
      }
    });
  }

  const removeModal = document.getElementById('adminPermissionsRemoveModal');
  const removeClose = document.getElementById('adminPermissionsRemoveModalClose');
  const removeConfirm = document.getElementById('adminPermissionsRemoveConfirm');

  if (removeClose) removeClose.addEventListener('click', closePermissionsRemoveModal);
  if (removeConfirm) {
    removeConfirm.addEventListener('click', async () => {
      const storeId = removeModal && removeModal.dataset.storeId;
      const email = removeModal && removeModal.dataset.email;
      const permType = removeModal && removeModal.dataset.permType ? removeModal.dataset.permType : 'allowed';
      if (!storeId || !email) return;
      removeConfirm.disabled = true;
      try {
        await patchStoreAllowedEmails(storeId, email, 'remove', permType === 'manager' ? 'manager' : undefined);
        closePermissionsRemoveModal();
        loadPermissionsView();
      } catch (e) {
        alert(e.message || '삭제에 실패했습니다.');
      } finally {
        removeConfirm.disabled = false;
      }
    });
  }
}

async function loadPermissionsView() {
  initPermissionsModalsOnce();
  const container = document.getElementById('adminPermissionsContent');
  if (!container) return;
  container.innerHTML = getAdminLoadingHtml();
  try {
    const { stores } = await fetchStores();
    if (!Array.isArray(stores) || stores.length === 0) {
      container.innerHTML = '<p class="admin-modal-hint">등록된 그룹(카테고리)이 없습니다. 매장관리에서 카테고리를 추가한 뒤 이용하세요.</p>';
      return;
    }
    const toAllowedEntries = (arr) => {
      if (!Array.isArray(arr)) return [];
      return arr.map((e) => (e && typeof e === 'object' && e.email != null ? { email: String(e.email).trim().toLowerCase(), addedAt: e.addedAt || null } : { email: String(e).trim().toLowerCase(), addedAt: null })).filter((x) => x.email);
    };
    const formatAddedAt = (addedAt) => (addedAt && /^\d{4}-\d{2}-\d{2}$/.test(addedAt) ? addedAt : '—');
    const productListHtml = stores
      .map((s) => {
        const titleEsc = escapeHtml(s.title || s.id || '');
        const storeIdEsc = escapeHtml(s.id || '');
        const entries = toAllowedEntries(s.allowedEmails);
        const emailsHtml = entries.length
          ? '<ul class="admin-permissions-emails-list">' +
            entries
              .map(
                (entry) =>
                  '<li class="admin-permissions-email-row">' +
                  '<button type="button" class="admin-permissions-email-chip" data-permissions-remove data-store-id="' +
                  escapeHtml(s.id || '') +
                  '" data-email="' +
                  escapeHtml(entry.email) +
                  '">' +
                  escapeHtml(entry.email) +
                  '</button>' +
                  '<span class="admin-permissions-date">' +
                  escapeHtml(formatAddedAt(entry.addedAt)) +
                  '</span></li>'
              )
              .join('') +
            '</ul>'
          : '<span class="admin-permissions-empty">등록된 사용자 없음</span>';
        return (
          '<div class="admin-permissions-row" data-store-id="' + storeIdEsc + '">' +
          '<div class="admin-permissions-group">' + titleEsc + '</div>' +
          '<div class="admin-permissions-users-wrap is-collapsed">' +
          '<div class="admin-permissions-users">' + emailsHtml + '</div>' +
          '</div>' +
          '<button type="button" class="admin-btn admin-permissions-toggle-btn" data-permissions-toggle aria-label="접기/열기"><span class="admin-permissions-toggle-icon">▼</span></button>' +
          '<button type="button" class="admin-btn admin-btn-primary admin-permissions-add-btn" data-permissions-add="' + storeIdEsc + '">사용자 추가</button>' +
          '</div>'
        );
      })
      .join('');
    const toManagerEntries = (s) => {
      const list = toAllowedEntries(s.managerEmails || []);
      const withoutMaster = list.filter((e) => e.email !== MASTER_MANAGER_EMAIL);
      return [{ email: MASTER_MANAGER_EMAIL, addedAt: null }, ...withoutMaster];
    };
    const seenGroupName = new Set();
    const managerRows = [];
    for (const s of stores) {
      const groupName = (s.suburl || s.id || '').toString().trim() || s.id || '';
      if (!groupName || seenGroupName.has(groupName)) continue;
      seenGroupName.add(groupName);
      managerRows.push({ groupName, store: s });
    }
    const managerListHtml = managerRows
      .map(({ groupName, store: s }) => {
        const groupNameEsc = escapeHtml(groupName);
        const storeIdEsc = escapeHtml(s.id || '');
        const entries = toManagerEntries(s);
        const emailsHtml =
          '<ul class="admin-permissions-emails-list">' +
          entries
            .map((entry) => {
              const isMaster = entry.email === MASTER_MANAGER_EMAIL;
              const dateStr = formatAddedAt(entry.addedAt);
              if (isMaster) {
                return '<li class="admin-permissions-email-row"><span class="admin-permissions-email-chip admin-permissions-email-chip--master">' + escapeHtml(entry.email) + '</span><span class="admin-permissions-date">' + escapeHtml(dateStr) + '</span></li>';
              }
              return (
                '<li class="admin-permissions-email-row">' +
                '<button type="button" class="admin-permissions-email-chip" data-permissions-remove-manager data-store-id="' +
                escapeHtml(s.id || '') +
                '" data-email="' +
                escapeHtml(entry.email) +
                '">' +
                escapeHtml(entry.email) +
                '</button>' +
                '<span class="admin-permissions-date">' +
                escapeHtml(dateStr) +
                '</span></li>'
              );
            })
            .join('') +
          '</ul>';
        return (
          '<div class="admin-permissions-row" data-store-id="' + storeIdEsc + '">' +
          '<div class="admin-permissions-group">' + groupNameEsc + '</div>' +
          '<div class="admin-permissions-users-wrap is-collapsed">' +
          '<div class="admin-permissions-users">' + emailsHtml + '</div>' +
          '</div>' +
          '<button type="button" class="admin-btn admin-permissions-toggle-btn" data-permissions-toggle aria-label="접기/열기"><span class="admin-permissions-toggle-icon">▼</span></button>' +
          '<button type="button" class="admin-btn admin-btn-primary admin-permissions-add-btn" data-permissions-add-manager="' + storeIdEsc + '">사용자 추가</button>' +
          '</div>'
        );
      })
      .join('');
    container.innerHTML =
      '<p class="admin-modal-hint" style="margin-bottom:12px;">상품 접근 권한 관리</p><div class="admin-permissions-list">' +
      productListHtml +
      '</div>' +
      '<p class="admin-modal-hint" style="margin-bottom:12px; margin-top:24px;">브랜드 매니저 권한 관리</p><div class="admin-permissions-list">' +
      managerListHtml +
      '</div>';
    container.querySelectorAll('[data-permissions-add]').forEach((btn) => {
      const storeId = btn.dataset.permissionsAdd;
      if (storeId) {
        btn.addEventListener('click', () => openPermissionsAddModal(storeId, 'allowed'));
      }
    });
    container.querySelectorAll('[data-permissions-add-manager]').forEach((btn) => {
      const storeId = btn.dataset.permissionsAddManager;
      if (storeId) {
        btn.addEventListener('click', () => openPermissionsAddModal(storeId, 'manager'));
      }
    });
    container.querySelectorAll('[data-permissions-remove]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const storeId = btn.dataset.storeId;
        const email = btn.dataset.email;
        if (storeId && email) openPermissionsRemoveModal(storeId, email, 'allowed');
      });
    });
    container.querySelectorAll('[data-permissions-remove-manager]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const storeId = btn.dataset.storeId;
        const email = btn.dataset.email;
        if (storeId && email) openPermissionsRemoveModal(storeId, email, 'manager');
      });
    });
    container.querySelectorAll('[data-permissions-toggle]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const row = btn.closest('.admin-permissions-row');
        const wrap = row ? row.querySelector('.admin-permissions-users-wrap') : null;
        const icon = btn.querySelector('.admin-permissions-toggle-icon');
        if (!wrap || !icon) return;
        const collapsed = wrap.classList.toggle('is-collapsed');
        icon.textContent = collapsed ? '▼' : '▲';
        btn.setAttribute('aria-label', collapsed ? '펼치기' : '접기');
      });
    });
  } catch (e) {
    container.innerHTML = '<p class="admin-error">' + escapeHtml(e.message || '로딩에 실패했습니다.') + '</p>';
  }
}

async function loadLogsView() {
  const container = document.getElementById('adminLogsContent');
  if (!container) return;
  container.innerHTML = getAdminLoadingHtml();
  const token = getToken();
  if (!token) {
    container.innerHTML = '<p class="admin-error">로그인이 필요합니다.</p>';
    return;
  }
  try {
    const res = await fetchWithTimeout(`${API_BASE}/api/admin/list-order-raw-logs`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      container.innerHTML = '<p class="admin-error">' + escapeHtml(data.error || '목록을 불러올 수 없습니다.') + '</p>';
      return;
    }
    const items = data.items || [];
    let html = '<h4 class="admin-logs-title">*logs</h4>';
    html += '<table class="admin-logs-table"><thead><tr><th>선택</th><th>날짜</th></tr></thead><tbody>';
    items.forEach((item) => {
      const dateEsc = escapeHtml(item.date);
      html += '<tr class="admin-logs-row"><td><input type="checkbox" class="admin-logs-checkbox" data-log-date="' + dateEsc + '" id="log-cb-' + dateEsc + '"></td><td><label for="log-cb-' + dateEsc + '">' + dateEsc + '</label></td></tr>';
    });
    html += '</tbody></table>';
    html += '<div class="admin-logs-footer"><button type="button" class="admin-logs-download-btn" id="adminLogsDownloadBtn">download</button></div>';
    container.innerHTML = html;

    let logsLastClickedIndex = -1;
    container.querySelector('.admin-logs-table tbody').addEventListener('click', (e) => {
      const cb = e.target.closest('.admin-logs-checkbox');
      if (!cb) return;
      const list = container.querySelectorAll('.admin-logs-checkbox');
      const idx = Array.prototype.indexOf.call(list, cb);
      if (idx < 0) return;
      if (e.shiftKey) {
        e.preventDefault();
        const from = logsLastClickedIndex < 0 ? 0 : Math.min(logsLastClickedIndex, idx);
        const to = logsLastClickedIndex < 0 ? idx : Math.max(logsLastClickedIndex, idx);
        for (let i = from; i <= to; i++) list[i].checked = true;
        logsLastClickedIndex = idx;
      } else {
        logsLastClickedIndex = idx;
      }
    });

    document.getElementById('adminLogsDownloadBtn').addEventListener('click', async () => {
      const checked = container.querySelectorAll('.admin-logs-checkbox:checked');
      if (!checked.length) {
        alert('다운로드할 로그 파일을 선택하세요.');
        return;
      }
      const token2 = getToken();
      if (!token2) return;
      const dateFormat = /^\d{4}-\d{2}-\d{2}$/;
      for (const cb of checked) {
        const date = (cb.dataset.logDate || '').trim();
        if (!dateFormat.test(date)) continue;
        try {
          const r = await fetch(`${API_BASE}/api/admin/download-order-raw-log?date=${encodeURIComponent(date)}`, {
            headers: { Authorization: `Bearer ${token2}` },
          });
          if (!r.ok) continue;
          const blob = await r.blob();
          const url = URL.createObjectURL(blob);
          const a = document.createElement('a');
          a.href = url;
          a.download = 'zeromartrawlog-' + date + '.csv';
          a.click();
          URL.revokeObjectURL(url);
        } catch (_) {}
      }
    });
  } catch (e) {
    container.innerHTML = '<p class="admin-error">' + escapeHtml(e.message || '로딩에 실패했습니다.') + '</p>';
  }
}

async function uploadImage(file) {
  const token = getToken();
  const formData = new FormData();
  formData.append('file', file);
  const res = await fetch(`${API_BASE}/api/admin/upload-image`, {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${token}` },
    body: formData,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || '업로드에 실패했습니다.');
  return data.url;
}

function showError(msg) {
  const el = document.getElementById('adminError');
  el.textContent = msg;
  el.style.display = 'block';
}

function hideError() {
  document.getElementById('adminError').style.display = 'none';
}

function generateId(prefix) {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
}

function generateStoreId() {
  return `store-${Date.now().toString(36)}`;
}

function renderStore(store, menus, groupNames) {
  const payment = store.payment || { apiKeyEnvVar: 'TOSS_SECRET_KEY' };
  const items = menus || [];
  const storeIdEsc = escapeHtml(store.id || '');
  const groups = Array.isArray(groupNames) ? groupNames : adminGroupNames;
  const suburlVal = (store.suburl || '').trim();
  const groupOptions = groups.map((g) => '<option value="' + escapeHtml(g) + '"' + (g === suburlVal ? ' selected' : '') + '>' + escapeHtml(g) + '</option>').join('');

  const allowedEmailsJson = JSON.stringify(store.allowedEmails || []);
  return `
    <div class="admin-store" id="admin-store-${storeIdEsc.replace(/"/g, '')}" data-store-id="${storeIdEsc}">
      <input type="hidden" data-field="allowedEmails" value="${escapeHtml(allowedEmailsJson.replace(/"/g, '&quot;'))}">
      <div class="admin-store-header">
        <span class="admin-store-title">${escapeHtml(store.title || store.id || '')}</span>
        <div class="admin-store-header-actions">
          <button type="button" class="admin-btn admin-btn-top" data-scroll-top aria-label="맨 위로">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 19V5M5 12l7-7 7 7"/></svg>
          </button>
          <button type="button" class="admin-btn admin-btn-danger admin-btn-delete-store" data-delete-store="${storeIdEsc}" title="카테고리 삭제">삭제</button>
        </div>
      </div>
      <div class="admin-store-body">
        <div class="admin-section">
          <div class="admin-section-title-row">
            <span class="admin-section-title">매장 정보</span>
            <button type="button" class="admin-btn admin-btn-icon admin-btn-settings" data-store-settings="${storeIdEsc}" aria-label="API 환경변수 설정" title="API 환경변수 설정">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>
            </button>
          </div>
          <div class="admin-form-row">
            <div class="admin-form-field">
              <label>대분류</label>
              <input type="text" data-field="title" value="${escapeHtml(store.title || '')}" placeholder="예: 도시락"${store.registered ? ' readonly' : ''}>
            </div>
          </div>
          <input type="hidden" data-field="apiKeyEnvVar" value="${escapeHtml(payment.apiKeyEnvVar || 'TOSS_SECRET_KEY')}">
          <input type="hidden" data-field="businessDays" value="${(store.businessDays && Array.isArray(store.businessDays) ? store.businessDays : [0,1,2,3,4,5,6]).join(',')}">
          <input type="hidden" data-field="businessHours" value="${(store.businessHours && Array.isArray(store.businessHours) ? store.businessHours : BUSINESS_HOURS_SLOTS).join(',')}">
        </div>
        <div class="admin-section">
          <div class="admin-section-title">브랜드</div>
          <div class="admin-form-row">
            <div class="admin-form-field">
              <label>브랜드명</label>
              <input type="text" data-field="brand" value="${escapeHtml(store.brand || '')}" placeholder="예: OO브랜드"${store.registered ? ' readonly' : ''}>
            </div>
            <div class="admin-form-field" style="flex: 2;">
              <label>매장주소</label>
              <input type="text" data-field="storeAddress" value="${escapeHtml(store.storeAddress || '')}" placeholder="예: 서울시 강남구 OO로 123">
            </div>
            <div class="admin-form-field">
              <label>사업자등록번호</label>
              <input type="text" data-field="bizNo" value="${escapeHtml(store.bizNo || '')}" placeholder="예: 000-00-00000">
            </div>
          </div>
          <div class="admin-form-row admin-form-row--brand-row2">
            <div class="admin-form-field admin-form-field--representative">
              <label>대표자</label>
              <input type="text" data-field="representative" value="${escapeHtml(store.representative || '')}" placeholder="대표자명">
        </div>
            <div class="admin-form-field">
              <label>담당자연락처</label>
              <input type="text" data-field="storeContact" value="${escapeHtml(store.storeContact || '')}" placeholder="예: 02-1234-5678">
            </div>
            <div class="admin-form-field admin-form-field--store-contact-email">
              <label>담당자이메일</label>
              <input type="email" data-field="storeContactEmail" value="${escapeHtml(store.storeContactEmail || '')}" placeholder="예: contact@example.com">
          </div>
            <div class="admin-form-field">
              <label>그룹명</label>
              <div class="admin-group-combo-row">
                <select data-field="suburl" class="admin-form-input admin-select-suburl" data-store-id="${storeIdEsc}">
                  <option value="">그룹선택</option>
                  ${groupOptions}
                </select>
                <button type="button" class="admin-btn admin-btn-add-group" data-add-group="${storeIdEsc}" title="새 그룹명 추가" aria-label="새 그룹명 추가">+</button>
              </div>
            </div>
          </div>
        </div>
        <div class="admin-section">
          <div class="admin-section-title-row admin-section-title-row--menu">
            <span class="admin-menu-title-with-toggle"><span class="admin-section-title">메뉴 (${items.length})</span>&nbsp;<button type="button" class="admin-btn admin-menu-toggle" data-menu-toggle="${storeIdEsc}" aria-label="메뉴 목록 펼치기" title="메뉴 목록 펼치기"><span class="admin-menu-toggle-icon" aria-hidden="true">▼</span></button></span>
            <div class="admin-menu-title-buttons">
              <button type="button" class="admin-btn-upload-menu" data-upload-menu="${storeIdEsc}">upload menu</button>&nbsp;<button type="button" class="admin-btn-sort-abc" data-sort-menu-abc="${storeIdEsc}">abc</button>
            </div>
          </div>
          <div class="admin-menu-list-wrap is-collapsed">
            <div class="admin-menu-list" data-store-id="${storeIdEsc}">
              ${items.map((item, i) => renderMenuItem(store.id, { ...item, registered: true }, i)).join('')}
            </div>
            <button type="button" class="admin-btn admin-btn-secondary admin-btn-add" data-add-menu="${storeIdEsc}">+ 메뉴 추가</button>
          </div>
        </div>
        <div class="admin-save-bar">
          <button type="button" class="admin-btn admin-btn-primary" data-save>저장</button>
        </div>
      </div>
    </div>
  `;
}

function renderMenuItem(storeId, item, index) {
  const nameReadonly = item.registered === true;
  return `
    <div class="admin-menu-item" data-menu-index="${index}" data-menu-id="${escapeHtml(item.id || '')}"${nameReadonly ? ' data-menu-registered="1"' : ''}>
      <div class="admin-menu-fields">
        <div class="admin-form-field">
          <label>메뉴명</label>
          <input type="text" data-field="name" value="${escapeHtml(item.name || '')}" placeholder="메뉴명"${nameReadonly ? ' readonly' : ''}>
        </div>
        <div class="admin-form-row">
          <div class="admin-form-field">
            <label>가격 (원)</label>
            <input type="number" data-field="price" value="${item.price || 0}" placeholder="0" min="0">
          </div>
          <div class="admin-form-field admin-form-field-image" style="flex: 2;">
            <label>이미지</label>
            <div class="admin-image-input-row">
              <input type="url" data-field="imageUrl" value="${escapeHtml(item.imageUrl || '')}" placeholder="URL 또는 업로드">
              <input type="file" data-upload-input accept="image/jpeg,image/png,image/webp,image/gif" style="display:none">
              <button type="button" class="admin-btn admin-btn-upload" data-upload-btn title="파일 업로드">📤 업로드</button>
            </div>
            <div class="admin-image-rule">${IMAGE_RULE}</div>
          </div>
        </div>
      </div>
      <div class="admin-menu-actions">
        <button type="button" class="admin-btn admin-btn-danger" data-remove-menu data-store-id="${escapeHtml(storeId)}" data-index="${index}">삭제</button>
      </div>
    </div>
  `;
}

/** 담당자연락처: 010으로 시작하는 11자리 휴대폰 번호만 허용 (공백/하이픈 제거 후 판단) */
function isValidKoreanMobile(value) {
  const trimmed = (value || '').trim();
  if (!trimmed) return true;
  const digits = trimmed.replace(/\D/g, '');
  return digits.length === 11 && digits.startsWith('010');
}

function collectData() {
  const stores = [];
  const menus = {};
  const list = document.getElementById('adminStoresList');
  const storeEls = list ? list.querySelectorAll('.admin-store') : document.querySelectorAll('.admin-store');

  storeEls.forEach((storeEl) => {
    const storeId = storeEl.dataset.storeId;
    const titleInput = storeEl.querySelector('input[data-field="title"]');
    const brandInput = storeEl.querySelector('input[data-field="brand"]');
    const storeAddressInput = storeEl.querySelector('input[data-field="storeAddress"]');
    const storeContactInput = storeEl.querySelector('input[data-field="storeContact"]');
    const storeContactEmailInput = storeEl.querySelector('input[data-field="storeContactEmail"]');
    const representativeInput = storeEl.querySelector('input[data-field="representative"]');
    const bizNoInput = storeEl.querySelector('input[data-field="bizNo"]');
    const suburlSelect = storeEl.querySelector('select[data-field="suburl"]');
    const apiKeyEnvVarInput = storeEl.querySelector('input[data-field="apiKeyEnvVar"]');
    const businessDaysInput = storeEl.querySelector('input[data-field="businessDays"]');
    const businessHoursInput = storeEl.querySelector('input[data-field="businessHours"]');
    const allowedEmailsInput = storeEl.querySelector('input[data-field="allowedEmails"]');
    let allowedEmails = [];
    try {
      const raw = (allowedEmailsInput?.value || '').replace(/&quot;/g, '"').trim() || '[]';
      allowedEmails = JSON.parse(raw);
      if (!Array.isArray(allowedEmails)) allowedEmails = [];
    } catch (_) {}
    const businessDaysStr = businessDaysInput?.value?.trim() || '0,1,2,3,4,5,6';
    const businessDays = businessDaysStr.split(',').map((d) => parseInt(d, 10)).filter((n) => !isNaN(n) && n >= 0 && n <= 6);
    const businessHoursStr = businessHoursInput?.value?.trim() || BUSINESS_HOURS_SLOTS.join(',');
    const businessHours = businessHoursStr.split(',').map((s) => s.trim()).filter((s) => BUSINESS_HOURS_SLOTS.includes(s));
    const store = { id: storeId, slug: storeId, title: titleInput?.value?.trim() || storeId, brand: brandInput?.value?.trim() || '', storeAddress: storeAddressInput?.value?.trim() || '', storeContact: storeContactInput?.value?.trim() || '', storeContactEmail: storeContactEmailInput?.value?.trim() || '', representative: representativeInput?.value?.trim() || '', bizNo: bizNoInput?.value?.trim() || '', suburl: (suburlSelect?.value?.trim() || ''), businessDays: businessDays.length ? businessDays.sort((a, b) => a - b) : [0, 1, 2, 3, 4, 5, 6], businessHours: businessHours.length ? businessHours : [...BUSINESS_HOURS_SLOTS], allowedEmails, payment: {
      apiKeyEnvVar: apiKeyEnvVarInput?.value?.trim() || 'TOSS_SECRET_KEY',
    } };
    stores.push(store);

    const menuList = storeEl.querySelector('.admin-menu-list');
    const items = [];
    menuList?.querySelectorAll('.admin-menu-item').forEach((itemEl) => {
      const nameInput = itemEl.querySelector('input[data-field="name"]');
      const priceInput = itemEl.querySelector('input[data-field="price"]');
      const imageInput = itemEl.querySelector('input[data-field="imageUrl"]');
      const name = nameInput?.value?.trim();
      if (!name) return;
      items.push({
        id: itemEl.dataset.menuId || generateId(storeId),
        name,
        price: parseInt(priceInput?.value || '0', 10) || 0,
        description: '',
        imageUrl: imageInput?.value?.trim() || '',
      });
    });
    menus[storeId] = items;
  });

  return { stores, menus };
}

function showLoadingError(msg, showRetry = false) {
  const content = document.getElementById('adminContent');
  content.innerHTML = `
    <div class="admin-loading admin-error">
      <p>${escapeHtml(msg || '')}</p>
      <p style="margin-top:12px;font-size:0.875rem;color:var(--color-text-secondary);">
        로그인 후 메인 화면에서 admin 링크를 통해 접속해 주세요.
      </p>
      <div style="margin-top:16px;display:flex;gap:8px;justify-content:center;flex-wrap:wrap;">
        <a href="/" class="admin-btn admin-btn-primary">메인으로</a>
        ${showRetry ? '<button type="button" class="admin-btn admin-btn-secondary" id="adminRetryBtn">다시 시도</button>' : ''}
      </div>
    </div>
  `;
  if (showRetry) {
    document.getElementById('adminRetryBtn')?.addEventListener('click', () => {
      document.getElementById('adminContent').innerHTML = getAdminLoadingHtml();
      init();
    });
  }
}

function setupTabs() {
  const tabs = document.querySelectorAll('.admin-tab');
  const views = document.querySelectorAll('.admin-view');
  
  function activateTab(targetTab) {
      tabs.forEach(t => t.classList.remove('active'));
      views.forEach(v => v.classList.remove('active'));
    const tabEl = document.querySelector(`.admin-tab[data-tab="${targetTab}"]`);
    if (tabEl) tabEl.classList.add('active');
      if (targetTab === 'stores') {
        document.getElementById('storesView').classList.add('active');
        clearPaymentIdleTimer();
        loadStoresView();
      } else if (targetTab === 'payments') {
        document.getElementById('paymentsView').classList.add('active');
        adminPaymentSubFilter = 'delivery_wait';
        loadPaymentManagement().then(() => startPaymentIdleRefresh());
      } else if (targetTab === 'stats') {
        document.getElementById('statsView').classList.add('active');
        loadStats();
      } else if (targetTab === 'settlement') {
        document.getElementById('settlementView').classList.add('active');
        loadSettlement();
      } else if (targetTab === 'permissions') {
        document.getElementById('permissionsView').classList.add('active');
        loadPermissionsView();
      } else if (targetTab === 'logs') {
        document.getElementById('logsView').classList.add('active');
        loadLogsView();
      }
  }

  tabs.forEach(tab => {
    tab.addEventListener('click', () => {
      const targetTab = tab.dataset.tab;
      if (targetTab) sessionStorage.setItem(ADMIN_TAB_KEY, targetTab);
      activateTab(targetTab);
    });
  });

  const nav = performance.getEntriesByType?.('navigation')?.[0];
  const isReload = nav?.type === 'reload' || (typeof performance.navigation !== 'undefined' && performance.navigation.type === 1);
  const saved = sessionStorage.getItem(ADMIN_TAB_KEY);
  const isMobile = () => window.matchMedia('(max-width: 768px)').matches;
  const tabToActivate = isMobile()
    ? (saved && ['payments', 'stats', 'permissions'].includes(saved) ? saved : 'payments')
    : (saved && ['stores', 'payments', 'stats', 'settlement', 'permissions', 'logs'].includes(saved) ? saved : 'stores');
  if (isReload && saved) {
    activateTab(tabToActivate);
  }
}

function sortPaymentOrders(orders, sortBy, dir) {
  const copy = orders.slice();
  const asc = (a, b) => (a < b ? -1 : a > b ? 1 : 0);
  copy.sort((a, b) => asc(new Date(a.created_at), new Date(b.created_at)));
  if ((dir || 'desc') === 'desc') copy.reverse();
  return copy;
}

const PAYMENT_CANCEL_WINDOW_MS = 45 * 60 * 1000; // 결제 취소 가능 45분

function isWithinPaymentCancelWindow(order) {
  if (order.status !== 'payment_completed') return false;
  const at = order.payment_completed_at || order.paymentCompletedAt;
  if (!at) return false;
  const ts = new Date(at).getTime();
  return !Number.isNaN(ts) && Date.now() - ts < PAYMENT_CANCEL_WINDOW_MS;
}

/** 결제 완료 후 45분 이내인 경우 취소 가능 남은 시간 "mm:ss" 반환, 그 외 null */
function getPaymentCompletedRemainingMmSs(order) {
  if (order.status !== 'payment_completed') return null;
  const at = order.payment_completed_at || order.paymentCompletedAt;
  if (!at) return null;
  const ts = new Date(at).getTime();
  if (Number.isNaN(ts)) return null;
  const remainingMs = PAYMENT_CANCEL_WINDOW_MS - (Date.now() - ts);
  if (remainingMs <= 0) return null;
  const totalSeconds = Math.min(45 * 60 - 1, Math.floor(remainingMs / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
}

let adminPaymentCountdownIntervalId = null;

function renderPaymentList() {
  if (adminPaymentCountdownIntervalId) {
    clearInterval(adminPaymentCountdownIntervalId);
    adminPaymentCountdownIntervalId = null;
  }
  const content = document.getElementById('adminPaymentContent');
  const allOrders = adminPaymentOrders;
  const cancelled = (o) => o.status === 'cancelled';

  const orderWaitStatuses = ['submitted', 'order_accepted', 'payment_link_issued'];
  const isOrderWait = (o) => !cancelled(o) && (orderWaitStatuses.includes(o.status) || isWithinPaymentCancelWindow(o));
  const isDeliveryWait = (o) => !cancelled(o) && o.status === 'payment_completed' && !isWithinPaymentCancelWindow(o);
  const newCount = allOrders.filter(isOrderWait).length;
  const deliveryWaitCount = allOrders.filter(isDeliveryWait).length;
  const deliveryCompletedCount = allOrders.filter(o => !cancelled(o) && o.status === 'delivery_completed').length;
  const cancelledCount = allOrders.filter(o => o.status === 'cancelled').length;

  const effectiveFilter = adminPaymentSubFilter === 'all' ? 'delivery_wait' : adminPaymentSubFilter;
  let filtered;
  if (effectiveFilter === 'new') {
    filtered = allOrders.filter(o => !cancelled(o) && (orderWaitStatuses.includes(o.status) || isWithinPaymentCancelWindow(o)));
  } else if (effectiveFilter === 'delivery_wait') {
    filtered = allOrders.filter(o => o.status === 'payment_completed' && !isWithinPaymentCancelWindow(o));
  } else if (effectiveFilter === 'delivery_completed') {
    filtered = allOrders.filter(o => o.status === 'delivery_completed');
  } else if (effectiveFilter === 'cancelled') {
    filtered = allOrders.filter(o => o.status === 'cancelled');
  } else {
    filtered = allOrders.filter(o => o.status === 'payment_completed');
  }

  const sortBy = adminPaymentSortBy;
  const dir = adminPaymentSortDir[sortBy] || 'desc';
  const sorted = sortPaymentOrders(filtered, sortBy, dir);

  const periodStartDate = getPaymentStartDateForPeriod(adminPaymentPeriod);
  const periodBar = `
    <div class="admin-payment-sort">
      <div class="admin-payment-period-btns">
        <button type="button" class="admin-payment-sort-btn admin-payment-period-btn ${adminPaymentPeriod === 'this_month' ? 'active' : ''}" data-period="this_month">이번달</button><span class="admin-payment-period-gap">&nbsp;</span><button type="button" class="admin-payment-sort-btn admin-payment-period-btn ${adminPaymentPeriod === '1_month' ? 'active' : ''}" data-period="1_month">1개월전부터</button><span class="admin-payment-period-gap">&nbsp;</span><button type="button" class="admin-payment-sort-btn admin-payment-period-btn ${adminPaymentPeriod === '3_months' ? 'active' : ''}" data-period="3_months">3개월전부터</button>
      </div>
      <div class="admin-payment-period-range">>> ${escapeHtml(periodStartDate)} ~ 현재</div>
    </div>
    <div class="admin-payment-subfilter">
      <div class="admin-payment-subfilter-row">
        <span class="admin-payment-subfilter-item ${adminPaymentSubFilter === 'new' ? 'active' : ''}" data-subfilter="new" role="button" tabindex="0">주문대기 ${newCount}개</span>
        <span class="admin-payment-subfilter-item ${adminPaymentSubFilter === 'delivery_wait' ? 'active' : ''}" data-subfilter="delivery_wait" role="button" tabindex="0">주문완료 ${deliveryWaitCount}개</span>
        <span class="admin-payment-subfilter-item ${adminPaymentSubFilter === 'delivery_completed' ? 'active' : ''}" data-subfilter="delivery_completed" role="button" tabindex="0">발송완료 ${deliveryCompletedCount}개</span>
        <span class="admin-payment-subfilter-item ${adminPaymentSubFilter === 'cancelled' ? 'active' : ''}" data-subfilter="cancelled" role="button" tabindex="0">취소주문 ${cancelledCount}개</span>
      </div>
    </div>
  `;

  const ordersHtml = sorted.map(order => {
    const isCancelled = order.status === 'cancelled';
    const isUrgent = false;
    const isPaymentDone = order.status === 'payment_completed' || order.status === 'shipping' || order.status === 'delivery_completed';
    const deliveryRowDisabled = order.status !== 'payment_completed' && order.status !== 'shipping';
    const orderIdEsc = escapeHtml(String(order.id));
    const orderNumberDisplay = escapeHtml(getOrderNumberDisplay(order)).replace(/, /g, '<br>');
    const orderIdEl = `<span class="admin-payment-order-id admin-payment-order-id-link" data-order-detail="${orderIdEsc}" role="button" tabindex="0">${orderNumberDisplay}</span>`;

    const isCountdownOrder = order.status === 'payment_completed' && isWithinPaymentCancelWindow(order);
    const paymentCompletedAt = order.payment_completed_at || order.paymentCompletedAt;
    const initialRemaining = isCountdownOrder ? getPaymentCompletedRemainingMmSs(order) : null;
    const statusLabel = initialRemaining != null
      ? `결제 완료 ${initialRemaining} 남음`
      : getStatusLabel(order.status, order.cancel_reason);
    const statusLabelEsc = escapeHtml(statusLabel);
    const statusCountdownAttr = isCountdownOrder && paymentCompletedAt
      ? ` data-payment-completed-at="${escapeHtml(String(paymentCompletedAt))}"`
      : '';
    const deliveryAddressEsc = escapeHtml([(order.delivery_address || '').trim(), (order.detail_address || '').trim()].filter(Boolean).join(' ') || '—');
    const hideDeliveryBtn = effectiveFilter === 'new';
    const isDeliveryCompletedFilter = effectiveFilter === 'delivery_completed';
    const showDeliveryInfo = isDeliveryCompletedFilter && order.status === 'delivery_completed';
    const deliveryInfoText = showDeliveryInfo
      ? (() => {
          const cc = (order.courier_company || '').trim();
          const tn = (order.tracking_number || '').trim();
          const hasParcel = !!cc || !!tn;
          if (order.delivery_type === 'direct') return '직접 배송 완료';
          if (hasParcel) return `${cc || '—'} / ${tn}`;
          return '배송 정보 없음';
        })()
      : '';
    const storeName = order.profileStoreName || '—';
    const ordererDisplay = effectiveFilter === 'delivery_wait'
      ? `${escapeHtml(storeName)} / ${escapeHtml(order.contact || '—')}`
      : `${escapeHtml(storeName)} / ${escapeHtml(order.depositor || '—')}`;

    return `
      <div class="admin-payment-order ${isCancelled ? 'admin-payment-order-cancelled' : ''}" data-order-id="${orderIdEsc}">
        <div class="admin-payment-order-header">
          ${orderIdEl}
          <span class="admin-payment-order-status ${order.status}"${statusCountdownAttr}>${statusLabelEsc}</span>
        </div>
        <div class="admin-payment-order-info">
          <div>주문시간: ${formatAdminOrderDate(order.created_at)}</div>
          <div>배송주소: ${deliveryAddressEsc}</div>
          <div>주문자: ${ordererDisplay}</div>
          <div>이메일: ${escapeHtml(order.user_email || '—')}</div>
        </div>
        <div class="admin-payment-link-row">
          ${effectiveFilter === 'cancelled'
            ? ''
            : hideDeliveryBtn
            ? '<span class="admin-payment-order-id admin-payment-order-notice">주문 완료 전입니다. 아직 발송하지 마세요.</span>'
            : showDeliveryInfo
            ? `<span class="admin-payment-delivery-info">*배송정보 : ${escapeHtml(deliveryInfoText)}</span>`
            : effectiveFilter === 'delivery_wait'
            ? ''
            : `<button type="button" class="admin-btn admin-btn-primary admin-payment-link-btn" data-open-delivery-modal="${orderIdEsc}" ${deliveryRowDisabled ? 'disabled' : ''}>발송 완료</button>`}
        </div>
        <div class="admin-payment-order-delete-row">
          ${effectiveFilter === 'delivery_wait' && !hideDeliveryBtn && !showDeliveryInfo && (order.status === 'payment_completed' || order.status === 'shipping') ? `<button type="button" class="admin-payment-delivery-row-btn" data-open-delivery-modal="${orderIdEsc}">발송 처리</button>` : ''}
          ${order.status !== 'cancelled' && (order.status === 'submitted' || order.status === 'order_accepted' || order.status === 'payment_link_issued') ? `<button type="button" class="admin-payment-cancel-btn" data-cancel-order="${orderIdEsc}">취소</button>` : ''}
          <button type="button" class="admin-payment-delete-btn" data-delete-order="${orderIdEsc}">삭제</button>
        </div>
      </div>
    `;
  }).join('');

  content.innerHTML = periodBar + ordersHtml;

  adminPaymentFlashIntervals.forEach(id => clearInterval(id));
  adminPaymentFlashIntervals = [];
  content.querySelectorAll('[data-overdue-flash]').forEach(el => {
    const id = setInterval(() => {
      el.classList.toggle('admin-overdue-show-msg');
    }, 1500);
    adminPaymentFlashIntervals.push(id);
  });

  function tickPaymentCountdown() {
    content.querySelectorAll('[data-payment-completed-at]').forEach(el => {
      const at = el.getAttribute('data-payment-completed-at');
      if (!at) return;
      const ts = new Date(at).getTime();
      if (Number.isNaN(ts)) return;
      const remainingMs = PAYMENT_CANCEL_WINDOW_MS - (Date.now() - ts);
      if (remainingMs <= 0) {
        el.textContent = '결제 완료';
        el.removeAttribute('data-payment-completed-at');
        return;
      }
      const totalSeconds = Math.floor(remainingMs / 1000);
      const minutes = Math.floor(totalSeconds / 60);
      const seconds = totalSeconds % 60;
      const mmss = `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
      el.textContent = `결제 완료 ${mmss} 남음`;
    });
  }
  tickPaymentCountdown();
  adminPaymentCountdownIntervalId = setInterval(tickPaymentCountdown, 1000);

  content.querySelectorAll('[data-period]').forEach(btn => {
    btn.addEventListener('click', () => {
      const period = btn.dataset.period;
      if (period && adminPaymentPeriod !== period) {
        adminPaymentPeriod = period;
        loadPaymentManagement();
      }
    });
  });

  content.querySelectorAll('[data-subfilter]').forEach(el => {
    const handler = () => {
      adminPaymentSubFilter = el.dataset.subfilter;
      renderPaymentList();
    };
    el.addEventListener('click', handler);
    el.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        handler();
      }
    });
  });

  content.querySelectorAll('[data-order-detail]').forEach(el => {
    el.addEventListener('click', () => {
      const orderId = el.dataset.orderDetail;
      const order = adminPaymentOrders.find(o => o.id === orderId);
      if (order) openAdminOrderDetail(order);
    });
  });

  content.querySelectorAll('[data-open-delivery-modal]').forEach(btn => {
    btn.addEventListener('click', () => {
      const orderId = btn.dataset.openDeliveryModal;
      openDeliveryCompleteModal(orderId);
    });
  });

  content.querySelectorAll('[data-cancel-order]').forEach(btn => {
    btn.addEventListener('click', async () => {
      const orderId = btn.dataset.cancelOrder;
      const code = prompt('주문 손님도 알고 계신거죠?\n취소 코드를 입력해주세요.');
      if (code === null) return;
      const trimmed = String(code).trim();
      if (trimmed !== orderId && trimmed !== `주문 #${orderId}`) {
        alert('취소 코드 오류입니다.');
        return;
      }
      try {
        const token = getToken();
        if (!token) return;
        const res = await fetch(`${API_BASE}/api/admin/cancel-order`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
          body: JSON.stringify({ orderId }),
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) {
          alert(data.error || '취소에 실패했습니다.');
          return;
        }
        const order = adminPaymentOrders.find((o) => o.id === orderId);
        if (order) order.status = 'cancelled';
        alert('주문이 취소되었습니다.');
        renderPaymentList();
      } catch (err) {
        alert(err.message || '취소에 실패했습니다.');
      }
    });
  });

  content.querySelectorAll('[data-delete-order]').forEach(btn => {
    btn.addEventListener('click', async () => {
      const orderId = btn.dataset.deleteOrder;
      const code = prompt('주문 내역이 완전히 삭제됩니다.\n삭제 코드를 입력해주세요.');
      if (code === null) return;
      const trimmed = String(code).trim();
      if (trimmed !== orderId && trimmed !== `주문 #${orderId}`) {
        alert('삭제 코드 오류입니다.');
        return;
      }
      try {
        const token = getToken();
        if (!token) return;
        const res = await fetch(`${API_BASE}/api/admin/delete-order`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
          body: JSON.stringify({ orderId }),
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) {
          alert(data.error || '삭제에 실패했습니다.');
          return;
        }
        adminPaymentOrders = adminPaymentOrders.filter((o) => o.id !== orderId);
        renderPaymentList();
      } catch (err) {
        alert(err.message || '삭제에 실패했습니다.');
      }
    });
  });
}

const PAYMENT_FULL_LOAD_LIMIT = 2000;

async function loadPaymentManagement() {
  const content = document.getElementById('adminPaymentContent');
  content.innerHTML = getAdminPeriodBarOnlyHtml() + '<div class="admin-loading-wrap">' + getAdminLoadingHtml() + '</div>';
  attachAdminPeriodListeners(content);

  try {
    const token = getToken();
    const startDate = getPaymentStartDateForPeriod(adminPaymentPeriod);
    const res = await fetchWithTimeout(`${API_BASE}/api/admin/orders?limit=${PAYMENT_FULL_LOAD_LIMIT}&offset=0&startDate=${encodeURIComponent(startDate)}`, {
      headers: { 'Authorization': `Bearer ${token}` },
    });

    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error || '주문 목록을 불러올 수 없습니다.');
    }

    const { orders, total } = await res.json();
    adminPaymentOrders = orders || [];
    adminPaymentTotal = typeof total === 'number' ? total : adminPaymentOrders.length;

    try {
      const storesRes = await fetchWithTimeout(`${API_BASE}/api/admin/stores`, {
        headers: { 'Authorization': `Bearer ${token}` },
      });
      if (storesRes.ok) {
        const { stores } = await storesRes.json();
        adminStoresMap = {};
        adminStoreOrder = [];
        (stores || []).forEach(s => {
          const slug = s.slug || s.id;
          const title = (s.title || s.brand || slug).toString().trim() || slug;
          adminStoresMap[slug] = title;
          if (s.id && s.id !== slug) adminStoresMap[s.id] = title;
          adminStoreOrder.push(slug);
        });
      }
    } catch (_) {}

    if (adminPaymentOrders.length === 0 && adminPaymentTotal === 0) {
      content.innerHTML = '<div class="admin-loading">주문 내역이 없습니다</div>';
      return;
    }

    renderPaymentList();
  } catch (e) {
    content.innerHTML = `<div class="admin-loading admin-error"><p>${escapeHtml(e.message || '오류가 발생했습니다.')}</p></div>`;
  }
}

async function refetchPaymentOrdersAndRender() {
  const content = document.getElementById('adminPaymentContent');
  try {
    const token = getToken();
    const startDate = getPaymentStartDateForPeriod(adminPaymentPeriod);
    const res = await fetchWithTimeout(`${API_BASE}/api/admin/orders?limit=${PAYMENT_FULL_LOAD_LIMIT}&offset=0&startDate=${encodeURIComponent(startDate)}`, {
      headers: { 'Authorization': `Bearer ${token}` },
    });
    if (!res.ok) return;
    const { orders, total } = await res.json();
    adminPaymentOrders = orders || [];
    adminPaymentTotal = typeof total === 'number' ? total : adminPaymentOrders.length;
    if (adminPaymentOrders.length === 0 && adminPaymentTotal === 0) {
      content.innerHTML = '<div class="admin-loading">주문 내역이 없습니다</div>';
      return;
    }
    renderPaymentList();
  } catch (_) {}
}

function resetPaymentIdleTimer() {
  if (paymentIdleTimerId != null) clearTimeout(paymentIdleTimerId);
  paymentIdleTimerId = setTimeout(() => {
    refetchPaymentOrdersAndRender().then(() => resetPaymentIdleTimer());
  }, PAYMENT_IDLE_MS);
}

function startPaymentIdleRefresh() {
  if (paymentIdleTimerId != null) clearTimeout(paymentIdleTimerId);
  paymentIdleTimerId = setTimeout(() => {
    refetchPaymentOrdersAndRender().then(() => resetPaymentIdleTimer());
  }, PAYMENT_IDLE_MS);
  if (!paymentIdleListenersAttached) {
    paymentIdleListenersAttached = true;
    document.addEventListener('click', resetPaymentIdleTimer);
    document.addEventListener('keydown', resetPaymentIdleTimer);
    document.addEventListener('input', resetPaymentIdleTimer);
  }
}

function clearPaymentIdleTimer() {
  if (paymentIdleTimerId != null) {
    clearTimeout(paymentIdleTimerId);
    paymentIdleTimerId = null;
  }
  if (paymentIdleListenersAttached) {
    paymentIdleListenersAttached = false;
    document.removeEventListener('click', resetPaymentIdleTimer);
    document.removeEventListener('keydown', resetPaymentIdleTimer);
    document.removeEventListener('input', resetPaymentIdleTimer);
  }
}

/** 현재 날짜를 KST 기준 YYYY-MM-DD */
function getTodayKST() {
  return new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Seoul' });
}

/** 주문관리 기간 버튼용: 이번달/1개월전/3개월전 시작일(YYYY-MM-DD, KST) */
function getPaymentStartDateForPeriod(period) {
  const today = getTodayKST();
  const [y, m] = today.split('-').map(Number);
  const pad = (n) => String(n).padStart(2, '0');
  if (period === 'this_month') return `${y}-${pad(m)}-01`;
  if (period === '1_month') {
    if (m <= 1) return `${y - 1}-12-01`;
    return `${y}-${pad(m - 1)}-01`;
  }
  if (period === '3_months') {
    let mm = m - 3;
    let yy = y;
    while (mm <= 0) { mm += 12; yy -= 1; }
    return `${yy}-${pad(mm)}-01`;
  }
  return `${y}-${pad(m)}-01`;
}
/** Date 또는 타임스탬프를 KST 기준 YYYY-MM-DD */
function toDateKeyKST(d) {
  if (d == null) return '';
  return new Date(d).toLocaleDateString('en-CA', { timeZone: 'Asia/Seoul' });
}
function getStatsDateStr(d) {
  return toDateKeyKST(d);
}
function getThisWeekMondayKST(dateStr) {
  const d = new Date(dateStr + 'T12:00:00+09:00');
  const day = d.getUTCDay();
  const diff = day === 0 ? 6 : day - 1;
  const monday = new Date(d.getTime() - diff * 86400000);
  return monday.toLocaleDateString('en-CA', { timeZone: 'Asia/Seoul' });
}
function getDefaultStatsRange() {
  const end = getTodayKST();
  const start = getThisWeekMondayKST(end);
  return { start, end };
}
function getPresetStatsRange(preset) {
  const today = getTodayKST();
  if (preset === 'today') return { start: today, end: today };
  if (preset === 'this_week') {
    const start = getThisWeekMondayKST(today);
    return { start, end: today };
  }
  if (preset === 'last_week') {
    const thisMon = getThisWeekMondayKST(today);
    const thisMonD = new Date(thisMon + 'T12:00:00+09:00');
    const lastSun = new Date(thisMonD.getTime() - 86400000);
    const lastMon = new Date(thisMonD.getTime() - 7 * 86400000);
    return { start: toDateKeyKST(lastMon.getTime()), end: toDateKeyKST(lastSun.getTime()) };
  }
  if (preset === 'this_month') {
    const d = new Date(today + 'T12:00:00+09:00');
    const first = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1));
    return { start: toDateKeyKST(first.getTime() + 9 * 3600000), end: today };
  }
  if (preset === 'last_month') {
    const [y, m] = today.split('-').map(Number);
    const lastMonthYear = m === 1 ? y - 1 : y;
    const lastMonthNum = m === 1 ? 12 : m - 1;
    const lastDayNum = new Date(lastMonthYear, lastMonthNum, 0).getDate();
    const start = `${lastMonthYear}-${String(lastMonthNum).padStart(2, '0')}-01`;
    const end = `${lastMonthYear}-${String(lastMonthNum).padStart(2, '0')}-${String(lastDayNum).padStart(2, '0')}`;
    return { start, end };
  }
  return null;
}

function getActiveStatsPreset(startVal, endVal) {
  const presets = ['today', 'this_week', 'last_week', 'this_month', 'last_month'];
  for (const p of presets) {
    const r = getPresetStatsRange(p);
    if (r && r.start === startVal && r.end === endVal) return p;
  }
  return null;
}

async function loadStats() {
  const content = document.getElementById('adminStatsContent');
  if (!content) return;
  const startInput = document.getElementById('adminStatsStartDate');
  const endInput = document.getElementById('adminStatsEndDate');
  let startDate = startInput?.value?.trim() || '';
  let endDate = endInput?.value?.trim() || '';
  const defaultRange = getDefaultStatsRange();
  if (!startDate) startDate = defaultRange.start;
  if (!endDate) endDate = defaultRange.end;

  content.innerHTML = getAdminLoadingHtml();
  try {
    const token = getToken();
    const params = new URLSearchParams();
    if (startDate) params.set('startDate', startDate);
    if (endDate) params.set('endDate', endDate);
    const res = await fetchWithTimeout(`${API_BASE}/api/admin/stats?${params.toString()}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      content.innerHTML = `<div class="admin-stats-error">${escapeHtml(err.error || '통계를 불러올 수 없습니다.')}</div>`;
      return;
    }
    const data = await res.json();
    adminStatsLastData = data;
    renderStats(content, data);
  } catch (e) {
    content.innerHTML = `<div class="admin-stats-error">${escapeHtml(e.message || '통계를 불러올 수 없습니다.')}</div>`;
  }
}

/** YYYY-MM-DD (KST 기준, 통계/정산용) */
function toDateKey(d) {
  return toDateKeyKST(d);
}

/** yy/mm/dd hh:mm:ss KST (실시간 시계용) */
function formatSettlementClock() {
  const x = new Date();
  const formatter = new Intl.DateTimeFormat('ko-KR', { timeZone: 'Asia/Seoul', year: '2-digit', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false });
  const parts = formatter.formatToParts(x);
  const get = (t) => parts.find((p) => p.type === t)?.value || '';
  return `${get('year')}/${get('month')}/${get('day')} ${get('hour')}:${get('minute')}:${get('second')}`;
}

function renderSettlementTable(byBrand) {
  const heading = '<br><h4 class="admin-settlement-list-heading">발송 완료 목록</h4>';
  if (!byBrand || byBrand.length === 0) {
    return heading + '<p class="admin-settlement-empty">해당 기간에 발송 완료된 주문이 없습니다.</p>';
  }
  const formatMoney = (n) => Number(n || 0).toLocaleString() + '원';
  let totalSales = 0;
  let totalFee = 0;
  let totalSettlement = 0;
  let html = heading + '<table class="admin-stats-table admin-settlement-table-cols5"><thead><tr><th>브랜드</th><th>주문 수</th><th>판매금액</th><th>수수료</th><th>정산금액</th></tr></thead><tbody>';
  byBrand.forEach((b) => {
    const sales = Number(b.totalAmount) || 0;
    const fee = Math.round(sales * 0.048);
    const settlement = sales - fee;
    totalSales += sales;
    totalFee += fee;
    totalSettlement += settlement;
    html += '<tr><td>' + escapeHtml(b.brandTitle || b.slug || '') + '</td><td>' + (b.orderCount || 0) + '</td><td>' + formatMoney(sales) + '</td><td>' + formatMoney(fee) + '</td><td>' + formatMoney(settlement) + '</td></tr>';
  });
  html += '<tr class="admin-settlement-total-row"><td></td><td></td><td>' + formatMoney(totalSales) + '</td><td>' + formatMoney(totalFee) + '</td><td>' + formatMoney(totalSettlement) + '</td></tr>';
  html += '</tbody></table>';
  return html;
}

function renderSettlementPendingList(pendingShipment) {
  const heading = '<h4 class="admin-settlement-pending-heading">주문 완료 (발송 완료 미처리) 목록</h4>';
  if (!pendingShipment || pendingShipment.length === 0) {
    return heading + '<p class="admin-settlement-empty">정산 구간 내 발송 완료 미처리 주문이 없습니다.</p>';
  }
  const formatMoney = (n) => Number(n || 0).toLocaleString() + '원';
  const statusLabel = (s) => (s === 'shipping' ? '배송중' : '결제완료');
  let totalAmount = 0;
  let html = heading;
  html += '<table class="admin-stats-table admin-settlement-table-cols5"><thead><tr><th>주문일</th><th>브랜드</th><th>주문번호</th><th>금액</th><th>상태</th></tr></thead><tbody>';
  pendingShipment.forEach((o) => {
    const amt = Number(o.total_amount) || 0;
    totalAmount += amt;
    html += '<tr><td>' + escapeHtml(o.orderDate || '') + '</td><td>' + escapeHtml(o.brandTitle || o.slug || '') + '</td><td>' + escapeHtml(String(o.id || '')) + '</td><td>' + formatMoney(amt) + '</td><td>' + escapeHtml(statusLabel(o.status)) + '</td></tr>';
  });
  html += '<tr class="admin-settlement-total-row"><td></td><td></td><td></td><td>' + formatMoney(totalAmount) + '</td><td></td></tr>';
  html += '</tbody></table>';
  return html;
}

let settlementClockIntervalId = null;

/** 정산일(10일·20일·말일) 목록. 2026-01-01부터 오늘(KST) 이전까지, 최신순 */
function getSettlementDateOptions() {
  const today = getTodayKST();
  const [tY, tM] = today.split('-').map(Number);
  const list = [];
  for (let y = 2026; y <= tY; y++) {
    const mEnd = y === tY ? tM : 12;
    for (let m = 1; m <= mEnd; m++) {
      const lastDay = new Date(y, m, 0).getDate();
      const pad = (n) => String(n).padStart(2, '0');
      const d10 = `${y}-${pad(m)}-10`;
      const d20 = `${y}-${pad(m)}-20`;
      const dLast = `${y}-${pad(m)}-${pad(lastDay)}`;
      if (d10 <= today) list.push(d10);
      if (d20 <= today && d20 !== d10) list.push(d20);
      if (dLast <= today && dLast !== d10 && dLast !== d20) list.push(dLast);
    }
  }
  list.sort((a, b) => b.localeCompare(a));
  return list;
}

/**
 * 정산관리 탭 전용 샘플 데이터 생성 (DB 미반영, 화면 확인용).
 * 2026-02-01부터 매일 09:00 KST 기준, 현재 등록 브랜드별 1건씩 주문·결제완료.
 * 월요일=발송완료 미처리(pending), 화~일=발송완료 처리.
 */
function getSettlementSampleData(startDate, endDate, stores) {
  const SAMPLE_START = '2026-02-01';
  const list = (stores || []).filter((s) => (s.slug || s.id || '').toString().trim());
  if (list.length === 0) return { startDate, endDate, byBrand: [], pendingShipment: [] };

  const bySlug = {};
  const pendingShipment = [];
  const pad = (n) => String(n).padStart(2, '0');
  const effectiveStart = startDate < SAMPLE_START ? SAMPLE_START : startDate;
  if (effectiveStart > endDate) return { startDate, endDate, byBrand: Object.values(bySlug), pendingShipment };

  const start = new Date(effectiveStart + 'T09:00:00+09:00');
  const end = new Date(endDate + 'T09:00:00+09:00');
  for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
    const y = d.getFullYear();
    const m = d.getMonth() + 1;
    const day = d.getDate();
    const dateStr = `${y}-${pad(m)}-${pad(day)}`;
    const isMonday = d.getDay() === 1;
    const status = isMonday ? 'payment_completed' : 'delivery_completed';
    list.forEach((store) => {
      const slug = (store.slug || store.id || '').toString().toLowerCase();
      const brandTitle = (store.brand || store.title || store.id || slug).toString().trim() || slug;
      const amount = 50000;
      const order = { id: 'sample-' + dateStr + '-' + slug, orderDate: dateStr, created_at: dateStr + 'T00:00:00.000Z', slug, brandTitle, total_amount: amount, status };
      if (isMonday) {
        pendingShipment.push(order);
      } else {
        if (!bySlug[slug]) bySlug[slug] = { slug, brandTitle, orderCount: 0, totalAmount: 0 };
        bySlug[slug].orderCount += 1;
        bySlug[slug].totalAmount += amount;
      }
    });
  }

  const byBrand = Object.values(bySlug).sort((a, b) => (a.brandTitle || '').localeCompare(b.brandTitle || '', 'ko'));
  pendingShipment.sort((a, b) => (a.orderDate || '').localeCompare(b.orderDate || '') || (a.id || '').localeCompare(b.id || ''));
  return { startDate, endDate, byBrand, pendingShipment };
}

/** 기준 정산일(10|20|말일)에 따른 정산 구간 { startDate, endDate } (YYYY-MM-DD)
 * - 기준일 10일 → 전월 3차 기간 (21일~말일)
 * - 기준일 20일 → 당월 1차 기간 (1일~10일)
 * - 기준일 말일 → 당월 2차 기간 (11일~20일)
 */
function getSettlementPeriodFromBaseDate(baseDateStr) {
  const [y, m, d] = baseDateStr.split('-').map(Number);
  const pad = (n) => String(n).padStart(2, '0');
  const lastDay = new Date(y, m, 0).getDate(); // 해당 월 마지막 날
  if (d === 10) {
    const prev = m === 1 ? { y: y - 1, m: 12 } : { y, m: m - 1 };
    const prevLast = new Date(prev.y, prev.m, 0).getDate();
    return { startDate: `${prev.y}-${pad(prev.m)}-21`, endDate: `${prev.y}-${pad(prev.m)}-${pad(prevLast)}` };
  }
  if (d === 20) return { startDate: `${y}-${pad(m)}-01`, endDate: `${y}-${pad(m)}-10` };
  return { startDate: `${y}-${pad(m)}-11`, endDate: `${y}-${pad(m)}-20` };
}

/** 정산서 출력용 기본 기간 (최근 7일) */
function getStatementDefaultRange() {
  const end = getTodayKST();
  const endD = new Date(end + 'T12:00:00+09:00');
  const startD = new Date(endD.getTime() - 6 * 86400000);
  return { start: toDateKeyKST(startD.getTime()), end };
}

/** 정산서 출력용 샘플 데이터 (SETTLEMENT_SAMPLE_DATA 시 사용). 기간 내 월요일 제외 일별 1건, 50_000원·수수료 4.8%. */
function getSettlementStatementSampleData(startDate, endDate, stores, slugFilter) {
  const list = (stores || []).filter((s) => (s.slug || s.id || '').toString().trim());
  const pad = (n) => String(n).padStart(2, '0');
  const SAMPLE_START = '2026-02-01';
  const effectiveStart = startDate < SAMPLE_START ? SAMPLE_START : startDate;
  if (effectiveStart > endDate) return [];

  const start = new Date(effectiveStart + 'T09:00:00+09:00');
  const end = new Date(endDate + 'T09:00:00+09:00');
  const out = [];
  list.forEach((store) => {
    const sid = (store.slug || store.id || '').toString().toLowerCase();
    if (slugFilter && sid !== slugFilter) return;
    const days = [];
    for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
      if (d.getDay() === 1) continue;
      const y = d.getFullYear();
      const m = d.getMonth() + 1;
      const day = d.getDate();
      days.push({
        date: `${y}-${pad(m)}-${pad(day)}`,
        orderCount: 1,
        totalAmount: 50000,
        fee: 2400,
        settlement: 47600,
      });
    }
    if (days.length > 0 || !slugFilter) {
      out.push({
        store,
        slug: sid,
        brandTitle: (store.brand || store.title || store.id || sid).toString().trim() || sid,
        storeContactEmail: (store.storeContactEmail || '').trim(),
        representative: (store.representative || '').trim(),
        startDate: effectiveStart,
        endDate,
        days,
        totalOrderCount: days.length,
        totalSales: days.length * 50000,
        totalFee: days.length * 2400,
        totalSettlement: days.length * 47600,
      });
    }
  });
  return slugFilter ? (out.length ? out : []) : out;
}

function renderSettlementStatementContent(data) {
  if (!data || !data.days) return '';
  const formatMoney = (n) => Number(n || 0).toLocaleString() + '원';
  const brandName = escapeHtml(data.brandTitle || data.slug || '');
  const periodText = (data.startDate || '') + ' ~ ' + (data.endDate || '');
  const contactEmail = escapeHtml(data.storeContactEmail || '');
  const repName = escapeHtml(data.representative || '');
  const issueDate = getTodayKST();

  let html = '<div class="admin-settlement-statement-print">';
  html += '<div class="admin-settlement-statement-print-inner">';
  html += '<div class="admin-settlement-statement-header">';
  html += '<p class="admin-settlement-statement-logo">Zero Mart</p>';
  html += '<p class="admin-settlement-statement-title">정산서</p>';
  html += '<p class="admin-settlement-statement-period">' + escapeHtml(periodText) + '</p>';
  html += '<hr class="admin-settlement-statement-hr">';
  html += '</div>';

  html += '<div class="admin-settlement-statement-brand">';
  html += '<br><p><strong>정산 브랜드 정보</strong></p><br>';
  html += '<p class="admin-settlement-statement-bullet">• 매장명: ' + brandName + '</p>';
  html += '<p class="admin-settlement-statement-bullet">• 담당자이메일: ' + contactEmail + '</p>';
  html += '<p class="admin-settlement-statement-bullet">• 대표자이름: ' + repName + '</p>';
  html += '</div>';

  html += '<div class="admin-settlement-statement-body">';
  html += '<br><p><strong>정산 내역</strong></p><br>';
  html += '<table class="admin-stats-table admin-settlement-statement-table"><thead><tr><th>일자</th><th>주문 수</th><th>판매금액</th><th>수수료</th><th>정산금액</th></tr></thead><tbody>';
  (data.days || []).forEach((row) => {
    html += '<tr><td>' + escapeHtml(row.date) + '</td><td>' + (row.orderCount || 0) + '</td><td>' + formatMoney(row.totalAmount) + '</td><td>' + formatMoney(row.fee) + '</td><td>' + formatMoney(row.settlement) + '</td></tr>';
  });
  html += '<tr class="admin-settlement-statement-total"><td>합계</td><td>' + (data.totalOrderCount || 0) + '</td><td>' + formatMoney(data.totalSales) + '</td><td>' + formatMoney(data.totalFee) + '</td><td>' + formatMoney(data.totalSettlement) + '</td></tr>';
  html += '</tbody></table>';
  html += '<br><hr class="admin-settlement-statement-hr admin-settlement-statement-hr--footer"><br>';
  html += '</div>';

  html += '<div class="admin-settlement-statement-footer">';
  html += '<p>* 수수료는 상품 판매가액(부가세 포함)의 4.8%이며, 정산금액 = 판매금액 − 수수료입니다.</p>';
  html += '<p>* 정산서 확인 후, 본사의 지정된 이메일 주소로 전자세금계산서 발행 부탁드립니다.</p>';
  html += '<p>* 정산금액은 귀사의 지정된 입금 계좌로 현금 지급됩니다.</p>';
  html += '</div>';
  html += '<br><br>';
  html += '<div class="admin-settlement-statement-issuer">';
  html += '<p>정산서 발행일: ' + escapeHtml(issueDate) + '</p>';
  html += '<p>정산서 발행처: (주)플라토스호스피탈리티그룹</p>';
  html += '</div>';
  html += '</div></div>';
  return html;
}

async function runSettlementStatementSearch() {
  const dateSelectEl = document.getElementById('adminSettlementDateSelect');
  const slugEl = document.getElementById('adminSettlementBrandSelect');
  const resultBox = document.getElementById('adminSettlementStatementResult');
  if (!dateSelectEl || !slugEl || !resultBox) return;
  const baseDate = (dateSelectEl.value || '').trim();
  if (!baseDate) {
    resultBox.innerHTML = '<p class="admin-stats-error">기준 정산일을 선택해 주세요.</p>';
    return;
  }
  const period = getSettlementPeriodFromBaseDate(baseDate);
  const startDate = period.startDate;
  const endDate = period.endDate;
  const slug = (slugEl.value || '').trim().toLowerCase();
  if (!slug) {
    resultBox.innerHTML = '<p class="admin-stats-error">브랜드를 선택해 주세요.</p>';
    return;
  }

  resultBox.innerHTML = getAdminLoadingHtml();
  if (SETTLEMENT_MOCK_FOR_TEST) {
    const days = [];
    const d = new Date(startDate + 'T12:00:00+09:00');
    const endMs = new Date(endDate + 'T12:00:00+09:00').getTime();
    const row = { orderCount: 1, totalAmount: 500000, fee: 24000, settlement: 476000 };
    for (let t = d.getTime(); t <= endMs; t += 86400000) {
      days.push({ date: toDateKeyKST(t), ...row });
    }
    const n = days.length;
    const mockStatementData = {
      brandTitle: '오늘Brand1',
      slug: 'todaybrand1',
      storeContactEmail: 'contact@todaybrand1.com',
      representative: '대표자명',
      startDate,
      endDate,
      days,
      totalOrderCount: n,
      totalSales: 500000 * n,
      totalFee: 24000 * n,
      totalSettlement: 476000 * n,
    };
    resultBox.innerHTML = renderSettlementStatementContent(mockStatementData);
    return;
  }
  if (SETTLEMENT_SAMPLE_DATA) {
    try {
      const storesRes = await fetchStores();
      const stores = (storesRes && storesRes.stores) || [];
      const items = getSettlementStatementSampleData(startDate, endDate, stores, slug);
      let html = '';
      (items || []).forEach((data) => {
        if (data.days && data.days.length > 0) html += renderSettlementStatementContent(data);
      });
      resultBox.innerHTML = html || '<p class="admin-settlement-empty">선택한 정산구간에 정산 내역이 있는 브랜드가 없습니다.</p>';
    } catch (e) {
      resultBox.innerHTML = '<p class="admin-stats-error">' + escapeHtml(e.message || '정산서를 불러올 수 없습니다.') + '</p>';
    }
    return;
  }
  const token = getToken();
  try {
    const res = await fetchWithTimeout(`${API_BASE}/api/admin/settlement-statement?startDate=${encodeURIComponent(startDate)}&endDate=${encodeURIComponent(endDate)}&slug=${encodeURIComponent(slug)}`, { headers: { Authorization: `Bearer ${token}` } });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      resultBox.innerHTML = '<p class="admin-stats-error">' + escapeHtml(err.error || '정산서를 불러올 수 없습니다.') + '</p>';
      return;
    }
    const data = await res.json();
    resultBox.innerHTML = renderSettlementStatementContent(data);
  } catch (e) {
    resultBox.innerHTML = '<p class="admin-stats-error">' + escapeHtml(e.message || '정산서를 불러올 수 없습니다.') + '</p>';
  }
}

function printSettlementStatement() {
  const wrap = document.getElementById('adminSettlementStatementResult');
  const printEl = wrap?.querySelector('.admin-settlement-statement-print');
  if (!printEl || !printEl.innerHTML.trim()) {
    alert('먼저 검색하여 정산서 내용을 불러온 뒤 PDF 출력해 주세요.');
    return;
  }
  const printStyles =
    'body{font-family:inherit;padding:24px;color:#333;font-size:14px;max-width:640px;margin:0 auto;}' +
    '.admin-settlement-statement-print{}' +
    '.admin-settlement-statement-header{text-align:center;margin-bottom:20px;}' +
    '.admin-settlement-statement-logo{margin:0 0 4px;font-size:1.25rem;font-weight:600;}' +
    '.admin-settlement-statement-title{margin:0 0 4px;font-size:0.875rem;color:#000;}' +
    '.admin-settlement-statement-period{margin:0 0 12px;font-size:0.875rem;color:#666;}' +
    '.admin-settlement-statement-hr{border:none;border-top:1px solid #ddd;margin:12px 0;}' +
    '.admin-settlement-statement-hr--footer{margin:20px 0 12px;}' +
    '.admin-settlement-statement-brand{margin-bottom:20px;font-size:0.875rem;}.admin-settlement-statement-brand p{margin:4px 0;}' +
    '.admin-settlement-statement-body{margin-bottom:12px;}.admin-settlement-statement-body>p{margin:0 0 8px;font-size:0.875rem;}' +
    'table{width:100%;border-collapse:collapse;}th,td{padding:10px 12px;text-align:left;border:1px solid #ddd;}' +
    'th{font-weight:600;background:#f5f5f5;}.admin-settlement-statement-total{font-weight:600;background:#f9f9f9;}' +
    '.admin-settlement-statement-footer{font-size:12px;color:#666;text-align:left;}.admin-settlement-statement-footer p{margin:4px 0;}' +
    '.admin-settlement-statement-issuer{text-align:left;font-size:13px;}.admin-settlement-statement-issuer p{margin:2px 0;}';
  const html = '<!DOCTYPE html><html><head><meta charset="UTF-8"><title>정산서</title><style>' + printStyles + '</style></head><body>' + printEl.outerHTML + '</body></html>';
  const blob = new Blob([html], { type: 'text/html;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const win = window.open(url, '_blank', 'noopener,noreferrer');
  if (!win) {
    URL.revokeObjectURL(url);
    alert('팝업이 차단되었을 수 있습니다. 브라우저에서 팝업을 허용해 주세요.');
    return;
  }
  win.focus();
  win.onafterprint = function () {
    URL.revokeObjectURL(url);
    win.close();
  };
  setTimeout(function () {
    win.print();
  }, 300);
}

async function loadSettlement() {
  const container = document.getElementById('adminSettlementContent');
  if (!container) return;

  const settlementDates = getSettlementDateOptions();
  const defaultDate = settlementDates[0] || getTodayKST();

  const dateSelectOptions = settlementDates.map((d) => '<option value="' + escapeHtml(d) + '"' + (d === defaultDate ? ' selected' : '') + '>' + escapeHtml(d) + '</option>').join('');

  const statementBlock =
    '<div class="admin-settlement-statement-area">' +
    '<h3 class="admin-settlement-statement-heading">정산서 출력</h3>' +
    '<div class="admin-stats-daterange" style="margin-bottom:16px;">' +
    '<select id="adminSettlementBrandSelect" class="admin-settlement-brand-select"></select>' +
    '</div>' +
    '<div id="adminSettlementStatementResult" class="admin-settlement-statement-result"></div>' +
    '<div style="margin-top:16px;"><button type="button" class="admin-btn admin-settlement-pdf-btn" id="adminSettlementPdfBtn">PDF 출력하기</button></div>' +
    '</div>';

  const defaultPeriod = getSettlementPeriodFromBaseDate(defaultDate);
  container.innerHTML =
    '<div class="admin-settlement-statement-area" style="margin-top:0; padding-top:0; border-top:none;">' +
    '<h3 class="admin-settlement-statement-heading">정산</h3>' +
    '<div class="admin-stats-daterange" style="margin-bottom:16px;">' +
    '<select id="adminSettlementGroupSelect" class="admin-settlement-brand-select" style="min-width:160px;"></select>' +
    '</div>' +
    '</div>' +
    '<section class="admin-stats-section">' +
    '<div class="admin-stats-daterange" style="margin-bottom:8px;">' +
    '<label for="adminSettlementDateSelect" class="admin-settlement-date-label">기준 정산일</label>' +
    '<select id="adminSettlementDateSelect" class="admin-settlement-date-select">' + dateSelectOptions + '</select>' +
    '</div>' +
    '<p class="admin-settlement-caption">&gt;&gt; 정산구간 : ' + escapeHtml(defaultPeriod.startDate) + ' ~ ' + escapeHtml(defaultPeriod.endDate) + '</p>' +
    '<div id="adminSettlementByDate"></div>' +
    '<div id="adminSettlementPending" class="admin-settlement-pending"></div>' +
    '</section>' +
    statementBlock;

  if (settlementClockIntervalId) clearInterval(settlementClockIntervalId);
  settlementClockIntervalId = null;

  const token = getToken();
  const contentBox = document.getElementById('adminSettlementByDate');
  if (contentBox) contentBox.innerHTML = getAdminLoadingHtml();

  function buildSlugToSuburl(stores) {
    const map = {};
    (stores || []).forEach((s) => {
      const slug = (s.slug || s.id || '').toString().toLowerCase();
      const suburl = (s.suburl || '').toString().trim();
      if (slug) map[slug] = suburl || '';
    });
    return map;
  }

  function filterSettlementByGroup(data, selectedGroup, slugToSuburl) {
    if (!selectedGroup) return data;
    const byBrand = (data.byBrand || []).filter((b) => slugToSuburl[b.slug] === selectedGroup);
    const pendingShipment = (data.pendingShipment || []).filter((p) => slugToSuburl[p.slug] === selectedGroup);
    return { ...data, byBrand, pendingShipment };
  }

  function populateSettlementBrandSelect(stores, selectedGroup) {
    const selectEl = document.getElementById('adminSettlementBrandSelect');
    if (!selectEl) return;
    while (selectEl.options.length) selectEl.remove(0);
    selectEl.appendChild(new Option('매장 선택', ''));
    let list = (stores || []).slice();
    if (selectedGroup) {
      list = list.filter((s) => ((s.suburl || '').toString().trim() || '') === selectedGroup);
    }
    list.sort((a, b) => {
      const ga = (a.suburl || a.id || '').toString().trim() || '';
      const gb = (b.suburl || b.id || '').toString().trim() || '';
      const c = ga.localeCompare(gb, 'ko');
      if (c !== 0) return c;
      const ba = (a.brand || a.title || a.id || '').toString().trim() || '';
      const bb = (b.brand || b.title || b.id || '').toString().trim() || '';
      return ba.localeCompare(bb, 'ko');
    });
    list.forEach((s) => {
      const sid = (s.slug || s.id || '').toString().toLowerCase();
      const groupName = (s.suburl || s.id || sid).toString().trim() || sid;
      const brandName = (s.brand || s.title || s.id || sid).toString().trim() || sid;
      const label = groupName + '/ ' + brandName;
      if (sid) selectEl.appendChild(new Option(label, sid));
    });
    selectEl.selectedIndex = 0;
  }

  async function fetchAndRenderSettlement(baseDateStr, stores, slugToSuburl) {
    const period = getSettlementPeriodFromBaseDate(baseDateStr);
    const box = document.getElementById('adminSettlementByDate');
    const pendingBox = document.getElementById('adminSettlementPending');
    const caption = document.querySelector('.admin-settlement-caption');
    const groupSelect = document.getElementById('adminSettlementGroupSelect');
    const selectedGroup = (groupSelect && groupSelect.value) ? groupSelect.value : '';
    if (caption) caption.textContent = '>> 정산구간 : ' + period.startDate + ' ~ ' + period.endDate;
    if (box) box.innerHTML = getAdminLoadingHtml();
    if (pendingBox) pendingBox.innerHTML = '';
    if (SETTLEMENT_MOCK_FOR_TEST) {
      if (box) box.innerHTML = renderSettlementTable([{ brandTitle: 'Brand1', orderCount: 1, totalAmount: 500000 }]);
      if (pendingBox) pendingBox.innerHTML = renderSettlementPendingList([]);
      return;
    }
    if (SETTLEMENT_SAMPLE_DATA) {
      const storesRes = await fetchStores();
      const sampleStores = (storesRes && storesRes.stores) || [];
      const data = getSettlementSampleData(period.startDate, period.endDate, sampleStores);
      const filtered = slugToSuburl && selectedGroup ? filterSettlementByGroup(data, selectedGroup, slugToSuburl) : data;
      if (box) box.innerHTML = '<p class="admin-settlement-sample-hint">&nbsp;</p>' + renderSettlementTable(filtered.byBrand || []);
      if (pendingBox) pendingBox.innerHTML = renderSettlementPendingList(filtered.pendingShipment || []);
      return;
    }
    try {
      const url = `${API_BASE}/api/admin/settlement?startDate=${encodeURIComponent(period.startDate)}&endDate=${encodeURIComponent(period.endDate)}`;
      const res = await fetchWithTimeout(url, { headers: { Authorization: `Bearer ${token}` } });
      let data = res.ok ? await res.json() : { byBrand: [], pendingShipment: [] };
      if (slugToSuburl && selectedGroup) data = filterSettlementByGroup(data, selectedGroup, slugToSuburl);
      if (box) box.innerHTML = renderSettlementTable(data.byBrand || []);
      if (pendingBox) pendingBox.innerHTML = renderSettlementPendingList(data.pendingShipment || []);
    } catch (e) {
      if (box) box.innerHTML = '<p class="admin-stats-error">' + escapeHtml(e.message || '정산 내역을 불러올 수 없습니다.') + '</p>';
      if (pendingBox) pendingBox.innerHTML = '';
    }
  }

  document.getElementById('adminSettlementDateSelect')?.addEventListener('change', function () {
    const groupSelect = document.getElementById('adminSettlementGroupSelect');
    const slugToSuburl = window._adminSettlementSlugToSuburl || {};
    const stores = window._adminSettlementStores || [];
    fetchAndRenderSettlement(this.value, stores, slugToSuburl);
    const resultBox = document.getElementById('adminSettlementStatementResult');
    if (resultBox) resultBox.innerHTML = '';
    const brandSelect = document.getElementById('adminSettlementBrandSelect');
    if (brandSelect) brandSelect.selectedIndex = 0;
  });

  document.getElementById('adminSettlementBrandSelect')?.addEventListener('change', runSettlementStatementSearch);
  document.getElementById('adminSettlementPdfBtn')?.addEventListener('click', printSettlementStatement);

  try {
    const storesData = await fetchStores();
    const stores = (storesData && storesData.stores) || [];
    window._adminSettlementStores = stores;
    const slugToSuburl = buildSlugToSuburl(stores);
    window._adminSettlementSlugToSuburl = slugToSuburl;

    const groupSelectEl = document.getElementById('adminSettlementGroupSelect');
    if (groupSelectEl) {
      groupSelectEl.appendChild(new Option('전체', ''));
      const groupNames = [...new Set(stores.map((s) => (s.suburl || '').toString().trim()).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'ko'));
      groupNames.forEach((g) => groupSelectEl.appendChild(new Option(g, g)));
      groupSelectEl.selectedIndex = 0;
      groupSelectEl.addEventListener('change', function () {
        const selGroup = this.value || '';
        populateSettlementBrandSelect(stores, selGroup);
        const dateSelect = document.getElementById('adminSettlementDateSelect');
        fetchAndRenderSettlement(dateSelect?.value || defaultDate, stores, slugToSuburl);
        const resultBox = document.getElementById('adminSettlementStatementResult');
        if (resultBox) resultBox.innerHTML = '';
      });
    }

    populateSettlementBrandSelect(stores, '');
    await fetchAndRenderSettlement(defaultDate, stores, slugToSuburl);
  } catch (e) {
    if (contentBox) contentBox.innerHTML = '<p class="admin-stats-error">' + escapeHtml(e.message || '정산 내역을 불러올 수 없습니다.') + '</p>';
  }
}

function renderStats(container, data) {
  const orderSummary = data.orderSummary || {};
  const revenue = data.revenue || {};
  const conversion = data.conversion || {};
  const delivery = data.delivery || {};
  const topMenus = data.topMenus || [];
  const timeSeries = data.timeSeries || [];
  const crm = data.crm || {};
  const alerts = data.alerts || {};
  const dateRange = data.dateRange || {};
  const defaultRange = getDefaultStatsRange();
  const startVal = dateRange.startDate || defaultRange.start;
  const endVal = dateRange.endDate || defaultRange.end;
  const formatMoney = (n) => Number(n || 0).toLocaleString() + '원';
  let html = '<div class="admin-stats-toolbar"><div class="admin-stats-daterange"><input type="date" id="adminStatsStartDate" value="' + escapeHtml(startVal) + '"><span>~</span><input type="date" id="adminStatsEndDate" value="' + escapeHtml(endVal) + '"><button type="button" class="admin-stats-search-btn" id="adminStatsApplyBtn" title="조회" aria-label="조회"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/></svg></button></div>';
  const activePreset = getActiveStatsPreset(startVal, endVal);
  const presetClass = (key) => 'admin-stats-preset-btn' + (activePreset === key ? ' active' : '');
  html += '<div class="admin-stats-presets">';
  html += '<div class="admin-stats-preset-row"><button type="button" class="' + presetClass('today') + '" data-preset="today">오늘</button><button type="button" class="' + presetClass('this_week') + '" data-preset="this_week">이번주</button><button type="button" class="' + presetClass('last_week') + '" data-preset="last_week">지난1주일</button><button type="button" class="' + presetClass('this_month') + '" data-preset="this_month">이번달</button><button type="button" class="' + presetClass('last_month') + '" data-preset="last_month">지난1개월</button></div>';
  html += '</div></div>';
  html += '<div class="admin-stats-section"><h3>주문 현황</h3><p class="admin-stats-big">총 주문 <strong>' + (orderSummary.total ?? 0) + '</strong>건</p><div class="admin-stats-grid">';
  const byStatus = orderSummary.byStatus || {};
  Object.entries(byStatus).forEach(function (e) {
    const v = e[1];
    html += '<div class="admin-stats-card"><span class="admin-stats-card-label">' + escapeHtml((v && v.label) || e[0]) + '</span><span class="admin-stats-card-value">' + ((v && v.count) ?? 0) + '</span></div>';
  });
  html += '</div><br><h4 class="admin-stats-brand-heading">브랜드별 주문</h4><ul class="admin-stats-list">';
  const byStore = orderSummary.byStore || {};
  Object.entries(byStore).forEach(function (e) {
    const v = e[1];
    const paymentCompleted = (v && v.paymentCompletedCount) ?? 0;
    const deliveryCompleted = (v && v.deliveryCompletedCount) ?? 0;
    html += '<li>' + escapeHtml((v && v.title) || e[0]) + ' : 주문완료 <strong>' + paymentCompleted + '</strong>건, 발송완료 <strong>' + deliveryCompleted + '</strong>건</li>';
  });
  html += '</ul></div>';
  const revTotal = Number(revenue.total) || 0;
  const totalRevText = formatMoney(revTotal);
  html += '<div class="admin-stats-section"><h3>매출</h3><p class="admin-stats-big">총 매출 <strong>' + totalRevText + '</strong></p><br><h4 class="admin-stats-brand-heading">브랜드별 매출</h4><ul class="admin-stats-list">';
  const revByStore = revenue.byStore || {};
  Object.entries(revByStore).forEach(function (e) {
    const v = e[1];
    const amt = Number(v && v.amount) || 0;
    html += '<li>' + escapeHtml((v && v.title) || e[0]) + ' : ' + formatMoney(amt) + '</li>';
  });
  html += '</ul></div>';
  html += '<div class="admin-stats-section"><h3 class="admin-stats-section-title-with-hint">일 매출</h3><table class="admin-stats-table admin-stats-table-cols3"><thead><tr><th>날짜</th><th>진행주문</th><th>매출</th></tr></thead><tbody>';
  timeSeries.slice(-14).reverse().forEach(function (d) {
    html += '<tr><td>' + escapeHtml(d.date) + '</td><td>' + d.orders + '</td><td>' + formatMoney(d.revenue) + '</td></tr>';
  });
  html += '</tbody></table></div>';
  const menuFilterLimit = adminStatsMenuFilter === 'top10' ? 10 : (topMenus.length || 20);
  const menuList = topMenus.slice(0, menuFilterLimit);
  const menuFilterLabel = adminStatsMenuFilter === 'top10' ? 'top10' : 'all';
  html += '<div class="admin-stats-section"><div class="admin-stats-section-title-row"><h3 class="admin-stats-section-title">메뉴 매출</h3><span class="admin-stats-menu-filter"><button type="button" class="admin-stats-menu-filter-btn active" data-menu-filter-toggle>' + menuFilterLabel + '</button></span></div><table class="admin-stats-table admin-stats-table-cols3 admin-stats-table-menu"><thead><tr><th>메뉴</th><th>진행주문</th><th>매출</th></tr></thead><tbody>';
  menuList.forEach(function (m) {
    html += '<tr><td>' + escapeHtml(m.name) + '</td><td>' + m.orderCount + '</td><td>' + formatMoney(m.revenue) + '</td></tr>';
  });
  html += '</tbody></table></div>';
  const totalOrders = Number(orderSummary.total) || 0;
  const n2 = Number(conversion.paymentCompleted) || 0;
  const n3 = Number(conversion.cancelledBeforePayment) || 0;
  const n4 = Number(conversion.cancelledAfterPayment) || 0;
  const n5 = Number(conversion.deliveryCompleted) || 0;
  const pct = (a, b) => (b > 0 ? ((a / b) * 100).toFixed(1) : '0.0');
  html += '<div class="admin-stats-section"><h3>전환율</h3><ul class="admin-stats-list">';
  html += '<li>전체 주문 <strong>' + totalOrders + '</strong> → 결제완료 <strong>' + n2 + '</strong> (' + pct(n2, totalOrders) + '%)</li>';
  html += '<li>전체 주문 <strong>' + totalOrders + '</strong> → 결제전취소 <strong>' + n3 + '</strong> (' + pct(n3, totalOrders) + '%)</li>';
  html += '<li>결제완료 <strong>' + n2 + '</strong> → 결제후취소 <strong>' + n4 + '</strong> (' + pct(n4, n2) + '%)</li>';
  html += '<li>결제완료 <strong>' + n2 + '</strong> → 발송완료 <strong>' + n5 + '</strong> (' + pct(n5, n2) + '%)</li>';
  html += '</ul></div>';
  html += '<div class="admin-stats-section admin-stats-section-crm"><h3>고객 분석</h3><table class="admin-stats-table"><thead><tr><th>이메일</th><th>진행주문</th><th>매출</th><th>마지막 주문일</th><th>고객 클러스터</th></tr></thead><tbody>';
  (crm.byCustomer || []).forEach(function (c) {
    const lastDate = c.lastOrderAt ? new Date(c.lastOrderAt).toLocaleDateString('ko-KR', { timeZone: 'Asia/Seoul' }) : '—';
    html += '<tr><td>' + escapeHtml(c.email) + '</td><td>' + c.orderCount + '</td><td>' + formatMoney(c.totalAmount) + '</td><td>' + lastDate + '</td><td>n/a</td></tr>';
  });
  html += '</tbody></table></div>';
  container.innerHTML = html;
  document.getElementById('adminStatsApplyBtn')?.addEventListener('click', loadStats);
  container.querySelectorAll('.admin-stats-preset-btn').forEach(function (btn) {
    btn.addEventListener('click', function () {
      const preset = btn.getAttribute('data-preset');
      const range = getPresetStatsRange(preset);
      if (!range) return;
      const startEl = document.getElementById('adminStatsStartDate');
      const endEl = document.getElementById('adminStatsEndDate');
      if (startEl) startEl.value = range.start;
      if (endEl) endEl.value = range.end;
      loadStats();
    });
  });
  container.querySelectorAll('[data-menu-filter-toggle]').forEach(function (btn) {
    btn.addEventListener('click', function () {
      adminStatsMenuFilter = adminStatsMenuFilter === 'top10' ? 'all' : 'top10';
      if (adminStatsLastData) renderStats(container, adminStatsLastData);
    });
  });
}

function getStatusLabel(status, cancelReason) {
  const s = (status || '').trim();
  const labels = {
    submitted: '주문 대기',
    order_accepted: '주문 대기',
    payment_link_issued: '주문 대기',
    payment_completed: '결제 완료',
    shipping: '발송 완료',
    delivery_completed: '발송 완료',
    cancelled: '주문취소',
  };
  const base = labels[s] || s || '—';
  return s === 'cancelled' && cancelReason ? `${base}(${cancelReason})` : base;
}

function formatAdminOrderDate(isoStr) {
  if (!isoStr) return '—';
  const d = new Date(isoStr);
  const formatter = new Intl.DateTimeFormat('ko-KR', { timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false });
  const parts = formatter.formatToParts(d);
  const get = (t) => parts.find((p) => p.type === t)?.value || '';
  return `${get('year')}.${get('month')}.${get('day')} ${get('hour')}:${get('minute')}`;
}

function formatAdminPrice(price) {
  return Number(price || 0).toLocaleString() + '원';
}

function renderAdminOrderDetailHtml(order) {
  const orderItems = order.order_items || [];
  const byCategory = {};
  for (const oi of orderItems) {
    const itemId = oi.id || '';
    const slug = (itemId.split('-')[0] || 'default');
    const item = { name: oi.name || '', price: Number(oi.price) || 0 };
    const qty = Number(oi.quantity) || 0;
    if (qty <= 0) continue;
    if (!byCategory[slug]) byCategory[slug] = [];
    byCategory[slug].push({ item, qty });
  }
  // 매장 순서를 따르되, 주문에만 있는 slug(매장 목록에 없을 수 있음)도 포함해 상세가 비지 않도록 함
  const byCategorySlugs = Object.keys(byCategory);
  const categoryOrder = adminStoreOrder.length
    ? [...adminStoreOrder, ...byCategorySlugs.filter((s) => !adminStoreOrder.includes(s))]
    : byCategorySlugs.sort();
  for (const slug of Object.keys(byCategory)) {
    byCategory[slug].sort((a, b) => (a.item.name || '').localeCompare(b.item.name || '', 'ko'));
  }
  const categoryTotals = {};
  for (const slug of Object.keys(byCategory)) {
    categoryTotals[slug] = byCategory[slug].reduce((sum, { item, qty }) => sum + item.price * qty, 0);
  }
  const renderItem = ({ item, qty }) => `
    <div class="admin-order-detail-item">
      <div class="cart-item-info">
        <div class="cart-item-name">${escapeHtml(item.name || '')}</div>
        <div class="cart-item-price">${formatAdminPrice(item.price)} × ${qty}</div>
      </div>
    </div>
  `;
  // 샘플 주문 등 서버에서 내려준 slug별 표시명이 있으면 우선 사용 (4번 매장 id가 'store'일 때 대분류명 정상 표시)
  const storeDisplayNames = order.store_display_names || {};
  return categoryOrder
    .filter(slug => byCategory[slug]?.length)
    .map(slug => {
      const title = storeDisplayNames[slug] || adminStoresMap[slug] || slug;
      const catTotal = categoryTotals[slug] || 0;
      const itemsHtml = byCategory[slug].map(renderItem).join('');
      return `
        <div class="cart-category-group">
          <div class="cart-category-header">
            <span class="cart-category-title">${escapeHtml(title || '')}</span>
            <span class="cart-category-total met">${formatAdminPrice(catTotal)}</span>
          </div>
          ${itemsHtml}
        </div>
      `;
    })
    .join('');
}

function openAdminOrderDetail(order) {
  const content = document.getElementById('adminOrderDetailContent');
  const totalEl = document.getElementById('adminOrderDetailTotal');
  const overlay = document.getElementById('adminOrderDetailOverlay');
  const panel = overlay?.querySelector('.admin-order-detail-panel');
  if (!content || !overlay) return;
  const html = renderAdminOrderDetailHtml(order);
  content.innerHTML = `<div class="order-detail-list order-detail-cart-style">${html}</div>`;
  if (totalEl) totalEl.textContent = formatAdminPrice(order.total_amount || 0);
  if (panel) panel.classList.toggle('admin-order-detail-cancelled', order.status === 'cancelled');
  const pdfWrap = document.getElementById('adminOrderDetailPdfWrap');
  if (pdfWrap) {
    const items = order.order_items || order.orderItems || [];
    const slugs = [...new Set(items.map((i) => ((i.id || '').toString().split('-')[0] || '').toLowerCase()).filter(Boolean))].sort();
    pdfWrap.innerHTML = '';
    pdfWrap.style.display = slugs.length ? '' : 'none';
    const pdfLabel = order.status === 'cancelled' ? '주문서 확인 (취소 건)' : '주문서 확인';
    slugs.forEach((slug, i) => {
      const orderNum = slugs.length === 1 ? '' : ` (${getOrderNumberDisplay(order).split(', ')[i] || `#${order.id}-${i + 1}`})`;
      const a = document.createElement('a');
      a.href = '#';
      a.className = 'admin-order-detail-pdf-btn';
      a.textContent = slugs.length === 1 ? pdfLabel : pdfLabel + orderNum;
      a.target = '_blank';
      a.rel = 'noopener noreferrer';
      const orderIdForPdf = order.id;
      const storeSlug = slug;
      a.onclick = async (e) => {
        e.preventDefault();
        const token = getToken();
        if (!token) return;
        try {
          const url = `${API_BASE}/api/orders/pdf?orderId=${encodeURIComponent(orderIdForPdf)}&store=${encodeURIComponent(storeSlug)}`;
          const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
          if (!res.ok) return;
          const blob = await res.blob();
          const blobUrl = URL.createObjectURL(blob);
          window.open(blobUrl, '_blank', 'noopener,noreferrer');
        } catch (_) {}
      };
      pdfWrap.appendChild(a);
    });
  }
  overlay.classList.add('visible');
  overlay.setAttribute('aria-hidden', 'false');
}

function closeAdminOrderDetail() {
  const overlay = document.getElementById('adminOrderDetailOverlay');
  if (overlay) {
    overlay.classList.remove('visible');
    overlay.setAttribute('aria-hidden', 'true');
  }
}

async function init() {
  const authResult = await checkAdmin();
  if (!authResult.ok) {
    window.location.replace('/');
    return;
  }
  
  setupTabs();
  loadPaymentManagement();

  document.getElementById('adminOrderDetailClose')?.addEventListener('click', closeAdminOrderDetail);
  document.getElementById('adminOrderDetailOverlay')?.addEventListener('click', (e) => {
    if (e.target.id === 'adminOrderDetailOverlay') closeAdminOrderDetail();
  });

  function closeApiSettingsModal() {
    const modal = document.getElementById('adminApiSettingsModal');
    if (modal) {
      modal.classList.remove('admin-modal-visible');
      modal.setAttribute('aria-hidden', 'true');
    }
  }
  function applyApiSettingsModal() {
    const modal = document.getElementById('adminApiSettingsModal');
    const modalInput = document.getElementById('adminApiSettingsEnvVar');
    const businessDaysContainer = document.getElementById('adminApiSettingsBusinessDays');
    const businessHoursContainer = document.getElementById('adminApiSettingsBusinessHours');
    const storeId = (modal?.dataset?.currentStoreId || '').trim();
    if (!storeId) return;
    const storeEl = document.getElementById('admin-store-' + storeId) || Array.from(document.querySelectorAll('.admin-store')).find((el) => (el.dataset.storeId || el.getAttribute('data-store-id')) === storeId);
    if (!storeEl) return;
    const apiKeyInput = storeEl.querySelector('input[data-field="apiKeyEnvVar"]');
    const businessDaysInput = storeEl.querySelector('input[data-field="businessDays"]');
    const businessHoursInput = storeEl.querySelector('input[data-field="businessHours"]');
    if (apiKeyInput) apiKeyInput.value = (modalInput?.value || '').trim() || 'TOSS_SECRET_KEY';
    if (businessDaysContainer && businessDaysInput) {
      const checked = Array.from(businessDaysContainer.querySelectorAll('input[data-day]:checked'))
        .map((cb) => parseInt(cb.dataset.day, 10))
        .sort((a, b) => a - b);
      businessDaysInput.value = checked.length ? checked.join(',') : '0,1,2,3,4,5,6';
    }
    if (businessHoursContainer && businessHoursInput) {
      const checked = Array.from(businessHoursContainer.querySelectorAll('input[data-slot]:checked'))
        .map((cb) => cb.dataset.slot)
        .filter(Boolean);
      businessHoursInput.value = checked.length ? checked.join(',') : BUSINESS_HOURS_SLOTS.join(',');
    }
    closeApiSettingsModal();
    alert('매장 하단 [저장] 버튼을 눌러 저장을 완료하세요.');
  }
  document.getElementById('adminApiSettingsModalClose')?.addEventListener('click', closeApiSettingsModal);
  document.getElementById('adminApiSettingsCancel')?.addEventListener('click', closeApiSettingsModal);
  document.getElementById('adminApiSettingsApply')?.addEventListener('click', applyApiSettingsModal);
  document.getElementById('adminApiSettingsModal')?.addEventListener('click', (e) => {
    if (e.target.id === 'adminApiSettingsModal') closeApiSettingsModal();
    if (e.target.closest('[data-settings-tab]')) {
      const tab = e.target.closest('[data-settings-tab]');
      const modal = tab.closest('#adminApiSettingsModal');
      if (!modal) return;
      const tabId = tab.dataset.settingsTab;
      modal.querySelectorAll('.admin-modal-tab').forEach((t) => t.classList.toggle('active', t.dataset.settingsTab === tabId));
      const panelMap = { 'payment-env': 'adminSettingsPanelPaymentEnv', 'business-days': 'adminSettingsPanelBusinessDays', 'business-hours': 'adminSettingsPanelBusinessHours' };
      const panelId = panelMap[tabId];
      modal.querySelectorAll('.admin-modal-panel').forEach((p) => p.classList.remove('active'));
      if (panelId) document.getElementById(panelId)?.classList.add('active');
    }
  });

  try {
    const { stores, menus } = await fetchStores();
    adminGroupNames = [...new Set(stores.map((s) => (s.suburl || '').trim()).filter(Boolean))].sort((a, b) => String(a).localeCompare(b, 'ko'));
    const content = document.getElementById('adminContent');
    const indexHtml = stores.length > 1
      ? `<div class="admin-index">
          <span class="admin-index-label">바로가기</span>
          <div class="admin-index-btns">
            ${stores.map((s) => `<button type="button" class="admin-btn admin-btn-index" data-goto-store="${escapeHtml(s.id || '')}">${escapeHtml(s.title || s.id || '')}</button>`).join('')}
          </div>
        </div>`
      : '';
    content.innerHTML = `
      ${indexHtml}
      <div class="admin-stores-list" id="adminStoresList">
        ${stores.map((s) => renderStore({ ...s, registered: true }, menus[s.id] || [], adminGroupNames)).join('')}
      </div>
      <div class="admin-add-store-row">
        <button type="button" class="admin-btn admin-btn-secondary admin-btn-add-store" data-add-store>+ 카테고리 추가</button>
        <button type="button" class="admin-btn admin-btn-reorder-stores" data-reorder-stores aria-label="카테고리 순서 변경" title="카테고리 순서 변경"><span class="admin-reorder-icon" aria-hidden="true">↕</span></button>
      </div>
    `;

    content.addEventListener('click', async (e) => {
      if (e.target.closest('[data-scroll-top]')) {
        window.scrollTo({ top: 0, behavior: 'smooth' });
      }
      if (e.target.closest('[data-menu-toggle]')) {
        const btn = e.target.closest('[data-menu-toggle]');
        const storeEl = btn.closest('.admin-store');
        const wrap = storeEl?.querySelector('.admin-menu-list-wrap');
        const icon = btn?.querySelector('.admin-menu-toggle-icon');
        if (wrap && icon) {
          const isCollapsed = wrap.classList.toggle('is-collapsed');
          icon.textContent = isCollapsed ? '▼' : '▲';
          btn.setAttribute('aria-label', isCollapsed ? '메뉴 목록 펼치기' : '메뉴 목록 접기');
          btn.setAttribute('title', isCollapsed ? '메뉴 목록 펼치기' : '메뉴 목록 접기');
        }
      }
      if (e.target.closest('[data-store-settings]')) {
        const btn = e.target.closest('[data-store-settings]');
        const storeEl = btn.closest('.admin-store');
        const storeId = storeEl?.dataset?.storeId;
        const apiKeyInput = storeEl?.querySelector('input[data-field="apiKeyEnvVar"]');
        const businessDaysInput = storeEl?.querySelector('input[data-field="businessDays"]');
        const businessHoursInput = storeEl?.querySelector('input[data-field="businessHours"]');
        const modal = document.getElementById('adminApiSettingsModal');
        const modalInput = document.getElementById('adminApiSettingsEnvVar');
        const modalTitle = document.getElementById('adminApiSettingsStoreTitle');
        const businessDaysContainer = document.getElementById('adminApiSettingsBusinessDays');
        const businessHoursContainer = document.getElementById('adminApiSettingsBusinessHours');
        if (storeId && apiKeyInput && modal && modalInput) {
          modal.dataset.currentStoreId = storeId;
          modalTitle.textContent = storeEl.querySelector('.admin-store-title')?.textContent || storeId;
          modalInput.value = apiKeyInput.value || 'TOSS_SECRET_KEY';
          const daysStr = businessDaysInput?.value || '0,1,2,3,4,5,6';
          const days = daysStr.split(',').map((d) => parseInt(d, 10)).filter((n) => !isNaN(n) && n >= 0 && n <= 6);
          businessDaysContainer?.querySelectorAll('input[data-day]').forEach((cb) => {
            cb.checked = days.includes(parseInt(cb.dataset.day, 10));
          });
          const hoursStr = businessHoursInput?.value || BUSINESS_HOURS_SLOTS.join(',');
          const hoursSet = new Set(hoursStr.split(',').map((s) => s.trim()).filter(Boolean));
          businessHoursContainer?.querySelectorAll('input[data-slot]').forEach((cb) => {
            cb.checked = hoursSet.has(cb.dataset.slot);
          });
          modal.querySelectorAll('.admin-modal-tab').forEach((t) => t.classList.remove('active'));
          modal.querySelector('[data-settings-tab="business-days"]')?.classList.add('active');
          modal.querySelectorAll('.admin-modal-panel').forEach((p) => p.classList.remove('active'));
          document.getElementById('adminSettingsPanelBusinessDays')?.classList.add('active');
          modal.classList.add('admin-modal-visible');
          modal.setAttribute('aria-hidden', 'false');
        }
      }
      if (e.target.closest('[data-goto-store]')) {
        const storeId = e.target.closest('[data-goto-store]').dataset.gotoStore;
        const el = document.getElementById(`admin-store-${storeId}`);
        if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }
      if (e.target.closest('[data-reorder-stores]')) {
        openReorderStoresModal();
      }
      if (e.target.closest('[data-add-store]')) {
        const list = document.getElementById('adminStoresList');
        const indexBtns = document.querySelector('.admin-index-btns');
        const newStore = {
          id: generateStoreId(),
          slug: generateStoreId(),
          title: '새 카테고리',
          brand: '',
          storeAddress: '',
          storeContact: '',
          storeContactEmail: '',
          representative: '',
          bizNo: '',
          suburl: '',
          businessDays: [0, 1, 2, 3, 4, 5, 6],
          businessHours: [...BUSINESS_HOURS_SLOTS],
          allowedEmails: [],
          payment: { apiKeyEnvVar: 'TOSS_SECRET_KEY' },
        };
        const div = document.createElement('div');
        div.innerHTML = renderStore(newStore, [], adminGroupNames);
        list.appendChild(div.firstElementChild);
        if (indexBtns) {
          const btn = document.createElement('button');
          btn.type = 'button';
          btn.className = 'admin-btn admin-btn-index';
          btn.dataset.gotoStore = newStore.id;
          btn.textContent = newStore.title;
          indexBtns.appendChild(btn);
        }
      }
      if (e.target.closest('[data-delete-store]')) {
        const btn = e.target.closest('[data-delete-store]');
        const storeEl = btn.closest('.admin-store');
        const list = document.getElementById('adminStoresList');
        if (list && list.querySelectorAll('.admin-store').length <= 1) {
          alert('최소 1개 이상의 카테고리가 필요합니다.');
          return;
        }
        const menuCount = storeEl.querySelectorAll('.admin-menu-item').length;
        if (menuCount > 0) {
          alert('메뉴가 1개라도 있으면 카테고리를 삭제할 수 없습니다. 먼저 메뉴를 모두 삭제해 주세요.');
          return;
        }
        if (confirm('이 카테고리를 삭제하시겠습니까?')) {
          const gotoBtn = content.querySelector(`[data-goto-store="${storeEl.dataset.storeId}"]`);
          if (gotoBtn) gotoBtn.remove();
          storeEl.remove();
          try {
            await handleSave();
          } catch (err) {
            showError(err.message);
          }
        }
      }
      if (e.target.closest('[data-upload-btn]')) {
        const btn = e.target.closest('[data-upload-btn]');
        const item = btn.closest('.admin-menu-item');
        const fileInput = item?.querySelector('[data-upload-input]');
        if (fileInput) fileInput.click();
      }
      if (e.target.closest('[data-sort-menu-abc]')) {
        const storeId = e.target.closest('[data-sort-menu-abc]').dataset.sortMenuAbc;
        const list = content.querySelector(`.admin-menu-list[data-store-id="${storeId}"]`);
        if (list) {
          const items = [];
          list.querySelectorAll('.admin-menu-item').forEach((itemEl) => {
            const nameInput = itemEl.querySelector('input[data-field="name"]');
            const priceInput = itemEl.querySelector('input[data-field="price"]');
            const imageInput = itemEl.querySelector('input[data-field="imageUrl"]');
            items.push({
              id: itemEl.dataset.menuId || generateId(storeId),
              name: nameInput?.value?.trim() || '',
              price: parseInt(priceInput?.value || '0', 10) || 0,
              description: '',
              imageUrl: imageInput?.value?.trim() || '',
              registered: itemEl.dataset.menuRegistered === '1',
            });
          });
          items.sort((a, b) => (a.name || '').localeCompare(b.name || '', 'ko'));
          list.innerHTML = items.map((item, i) => renderMenuItem(storeId, item, i)).join('');
          list.querySelectorAll('.admin-menu-item').forEach((el, i) => {
            el.dataset.menuId = items[i].id;
          });
        }
      }
      if (e.target.closest('[data-upload-menu]')) {
        const storeId = e.target.closest('[data-upload-menu]').dataset.uploadMenu;
        const csvInput = document.getElementById('adminMenuCsvInput');
        if (csvInput && storeId) {
          csvInput.dataset.uploadForStore = storeId;
          csvInput.value = '';
          csvInput.click();
        }
      }
      if (e.target.closest('[data-add-menu]')) {
        const storeId = e.target.closest('[data-add-menu]').dataset.addMenu;
        const list = content.querySelector(`.admin-menu-list[data-store-id="${storeId}"]`);
        const newItem = { id: generateId(storeId), name: '', price: 0, imageUrl: '' };
        const div = document.createElement('div');
        div.innerHTML = renderMenuItem(storeId, newItem, list.children.length);
        const itemEl = div.firstElementChild;
        itemEl.dataset.menuId = newItem.id;
        list.appendChild(itemEl);
        const menuTitle = list.closest('.admin-store')?.querySelector('.admin-section-title-row--menu .admin-section-title');
        if (menuTitle) menuTitle.textContent = '메뉴 (' + list.children.length + ')';
      }
      if (e.target.closest('[data-remove-menu]')) {
        const btn = e.target.closest('[data-remove-menu]');
        const itemEl = btn?.closest('.admin-menu-item');
        const menuId = itemEl?.dataset?.menuId;
        const storeEl = itemEl?.closest('.admin-store');
        const storeId = storeEl?.dataset?.storeId;
        if (menuId) {
          try {
            const token = getToken();
            const res = await fetch(`${API_BASE}/api/admin/check-menu-in-use?menuId=${encodeURIComponent(menuId)}`, {
              headers: { Authorization: `Bearer ${token}` },
            });
            const data = await res.json().catch(() => ({}));
            if (data.inUse === true) {
              alert('해당 메뉴는 주문 진행중입니다.');
              return;
            }
          } catch (err) {
            alert(err.message || '확인에 실패했습니다.');
            return;
          }
        }
        itemEl?.remove();
        if (storeId) {
          const list = content.querySelector(`.admin-menu-list[data-store-id="${storeId}"]`);
          const menuTitle = storeEl?.querySelector('.admin-section-title-row--menu .admin-section-title');
          if (menuTitle && list) menuTitle.textContent = '메뉴 (' + list.children.length + ')';
        }
      }
      if (e.target.closest('[data-add-group]')) {
        const btn = e.target.closest('[data-add-group]');
        const storeId = btn.dataset.addGroup;
        const name = (prompt('새 그룹명을 입력하세요') || '').trim();
        if (!name) return;
        if (!adminGroupNames.includes(name)) {
          adminGroupNames.push(name);
          adminGroupNames.sort();
          content.querySelectorAll('select[data-field="suburl"]').forEach((sel) => {
            const hasOpt = Array.from(sel.options).some((o) => o.value === name);
            if (!hasOpt) {
              const opt = document.createElement('option');
              opt.value = name;
              opt.textContent = name;
              sel.appendChild(opt);
            }
          });
        }
        const currentSelect = btn.closest('.admin-store')?.querySelector('select[data-field="suburl"]');
        if (currentSelect) currentSelect.value = name;
      }
      if (e.target.closest('[data-save]')) {
        handleSave();
      }
    });


    content.addEventListener('change', async (e) => {
      const input = e.target.closest('[data-upload-input]');
      if (!input || !input.files?.length) return;
      const file = input.files[0];
      const item = input.closest('.admin-menu-item');
      const urlInput = item?.querySelector('input[data-field="imageUrl"]');
      const btn = item?.querySelector('[data-upload-btn]');
      if (!urlInput) return;
      const origText = btn?.textContent;
      if (btn) btn.disabled = true;
      if (btn) btn.textContent = '업로드 중...';
      try {
        const url = await uploadImage(file);
        urlInput.value = url;
      } catch (err) {
        alert(err.message);
      } finally {
        input.value = '';
        if (btn) { btn.disabled = false; btn.textContent = origText || '📤 업로드'; }
      }
    });

    const csvInput = document.getElementById('adminMenuCsvInput');
    if (csvInput && !csvInput.dataset.listenerAttached) {
      csvInput.dataset.listenerAttached = '1';
      csvInput.addEventListener('change', async (e) => {
        const input = e.target;
        const storeId = (input.dataset.uploadForStore || '').trim();
        if (!storeId || !input.files?.length) {
          input.value = '';
          return;
        }
        const file = input.files[0];
        const content = document.getElementById('adminContent');
        const list = content?.querySelector(`.admin-menu-list[data-store-id="${storeId}"]`);
        if (!list) {
          input.value = '';
          input.removeAttribute('data-upload-for-store');
          return;
        }
        let text = '';
        try {
          text = (await file.text()).replace(/^\uFEFF/, '');
        } catch (err) {
          alert('파일을 읽을 수 없습니다.');
          input.value = '';
          return;
        }
        const lines = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n').map((l) => l.trim()).filter(Boolean);
        if (lines.length < 2) {
          alert('CSV 파일은 1행 제목(메뉴명, 가격), 2행부터 데이터가 필요합니다.');
          input.value = '';
          return;
        }
        const startIndex = list.children.length;
        let added = 0;
        for (let i = 1; i < lines.length; i++) {
          const parts = lines[i].split(',').map((p) => p.trim().replace(/^"|"$/g, ''));
          const name = (parts[0] || '').trim();
          if (!name) continue;
          const price = parseInt(parts[1], 10) || 0;
          const newItem = { id: generateId(storeId), name, price, imageUrl: '' };
          const div = document.createElement('div');
          div.innerHTML = renderMenuItem(storeId, newItem, startIndex + added);
          const itemEl = div.firstElementChild;
          itemEl.dataset.menuId = newItem.id;
          list.appendChild(itemEl);
          added++;
        }
        input.value = '';
        input.removeAttribute('data-upload-for-store');
        if (added > 0) {
          const menuTitle = list.closest('.admin-store')?.querySelector('.admin-section-title-row--menu .admin-section-title');
          if (menuTitle) menuTitle.textContent = '메뉴 (' + list.children.length + ')';
          alert(`${added}개 메뉴가 목록에 추가되었습니다. 저장 버튼을 눌러 반영해 주세요.`);
        }
      });
    }
  } catch (err) {
    showLoadingError(err.message || '로딩에 실패했습니다.', true);
    document.getElementById('adminError').style.display = 'none';
  }
}

function openReorderStoresModal() {
  const list = document.getElementById('adminStoresList');
  if (!list) return;
  const storeEls = list.querySelectorAll('.admin-store');
  const items = [...storeEls].map((el) => ({
    id: el.dataset.storeId,
    title: (el.querySelector('.admin-store-title')?.textContent?.trim()) || (el.querySelector('input[data-field="title"]')?.value?.trim()) || el.dataset.storeId || '',
  }));
  const listContainer = document.getElementById('adminReorderStoresList');
  if (!listContainer) return;
  listContainer.innerHTML = items
    .map(
      (item) =>
        `<li data-store-id="${escapeHtml(item.id)}" class="admin-reorder-modal-item">
          <span class="admin-reorder-modal-title">${escapeHtml(item.title)}</span>
          <div class="admin-reorder-modal-move">
            <button type="button" data-move-up aria-label="위로">↑</button>
            <button type="button" data-move-down aria-label="아래로">↓</button>
          </div>
        </li>`
    )
    .join('');
  const modal = document.getElementById('adminReorderStoresModal');
  if (modal) {
    modal.classList.add('admin-modal-visible');
    modal.setAttribute('aria-hidden', 'false');
  }
}

function closeReorderStoresModal() {
  const modal = document.getElementById('adminReorderStoresModal');
  if (modal) {
    modal.classList.remove('admin-modal-visible');
    modal.setAttribute('aria-hidden', 'true');
  }
}

function applyReorderAndSave() {
  const listEl = document.getElementById('adminReorderStoresList');
  const storesList = document.getElementById('adminStoresList');
  const indexBtns = document.querySelector('.admin-index-btns');
  if (!listEl || !storesList) return;
  const order = [...listEl.querySelectorAll('li')].map((li) => li.dataset.storeId);
  const storeEls = storesList.querySelectorAll('.admin-store');
  const byId = {};
  storeEls.forEach((el) => {
    byId[el.dataset.storeId] = el;
  });
  order.forEach((id) => {
    if (byId[id]) storesList.appendChild(byId[id]);
  });
  if (indexBtns) {
    const btns = indexBtns.querySelectorAll('[data-goto-store]');
    const btnById = {};
    btns.forEach((b) => {
      btnById[b.dataset.gotoStore] = b;
    });
    order.forEach((id) => {
      if (btnById[id]) indexBtns.appendChild(btnById[id]);
    });
  }
  handleSave();
}

async function handleSave() {
  hideError();
  try {
    const { stores, menus } = collectData();
    for (const store of stores) {
      if (!isValidKoreanMobile(store.storeContact)) {
        alert('정상적인 핸드폰 번호를 입력해주세요.');
        return;
      }
    }
    await saveStores(stores, menus);
    const indexBtns = document.querySelector('.admin-index-btns');
    if (indexBtns) {
      indexBtns.querySelectorAll('[data-goto-store]').forEach((btn) => {
        const storeId = btn.dataset.gotoStore;
        const store = stores.find((s) => s.id === storeId);
        if (store) btn.textContent = (store.title || storeId || '').trim() || storeId;
      });
    }
    alert('저장되었습니다.');
  } catch (err) {
    showError(err.message);
  }
}

function openDeliveryCompleteModal(orderId) {
  adminDeliveryModalOrderId = orderId;
  const modal = document.getElementById('adminDeliveryCompleteModal');
  if (!modal) return;
  const courierSelect = document.getElementById('adminDeliveryCourierSelect');
  const trackingInput = document.getElementById('adminDeliveryTrackingInput');
  if (courierSelect) courierSelect.value = '';
  if (trackingInput) trackingInput.value = '';
  modal.classList.add('admin-modal-visible');
  modal.setAttribute('aria-hidden', 'false');
}

function closeDeliveryCompleteModal() {
  const modal = document.getElementById('adminDeliveryCompleteModal');
  if (modal) {
    modal.classList.remove('admin-modal-visible');
    modal.setAttribute('aria-hidden', 'true');
  }
  adminDeliveryModalOrderId = null;
}

async function submitDeliveryCompleteDirect() {
  const orderId = adminDeliveryModalOrderId;
  if (!orderId) return;
  const token = getToken();
  if (!token) return;
  try {
    const res = await fetch(`${API_BASE}/api/admin/delivery-complete`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ orderId, code: orderId }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || '처리에 실패했습니다.');
    const order = adminPaymentOrders.find(o => o.id === orderId);
    if (order) order.status = 'delivery_completed';
    alert('직접 배송 완료 처리되었습니다.');
    closeDeliveryCompleteModal();
    renderPaymentList();
  } catch (e) {
    alert(e.message || '처리에 실패했습니다.');
  }
}

async function submitDeliveryCompleteParcel() {
  const orderId = adminDeliveryModalOrderId;
  if (!orderId) return;
  const courierSelect = document.getElementById('adminDeliveryCourierSelect');
  const trackingInput = document.getElementById('adminDeliveryTrackingInput');
  const courierCompany = courierSelect?.value?.trim() || '';
  const trackingNumber = (trackingInput?.value || '').trim();
  if (!trackingNumber) {
    alert('송장 번호를 입력해 주세요.');
    return;
  }
  const token = getToken();
  if (!token) return;
  try {
    const res = await fetch(`${API_BASE}/api/admin/delivery-complete`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ orderId, courierCompany, trackingNumber }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || '저장에 실패했습니다.');
    const order = adminPaymentOrders.find(o => o.id === orderId);
    if (order) {
      order.status = 'delivery_completed';
      order.courier_company = courierCompany || null;
      order.tracking_number = (trackingNumber || '').replace(/\D/g, '') || null;
    }
    alert('저장되었습니다.');
    closeDeliveryCompleteModal();
    renderPaymentList();
  } catch (e) {
    alert(e.message || '저장에 실패했습니다.');
  }
}

(function bindDeliveryCompleteModal() {
  const modal = document.getElementById('adminDeliveryCompleteModal');
  if (!modal) return;
  document.getElementById('adminDeliveryCompleteModalClose')?.addEventListener('click', closeDeliveryCompleteModal);
  document.getElementById('adminDeliveryCompleteDirectBtn')?.addEventListener('click', submitDeliveryCompleteDirect);
  document.getElementById('adminDeliveryParcelSaveBtn')?.addEventListener('click', submitDeliveryCompleteParcel);
  modal.addEventListener('click', (e) => {
    if (e.target === modal) closeDeliveryCompleteModal();
  });
})();

(function bindReorderStoresModal() {
  const modal = document.getElementById('adminReorderStoresModal');
  if (!modal) return;
  modal.querySelector('#adminReorderStoresModalClose')?.addEventListener('click', closeReorderStoresModal);
  modal.querySelector('#adminReorderStoresCancel')?.addEventListener('click', closeReorderStoresModal);
  modal.querySelector('#adminReorderStoresConfirm')?.addEventListener('click', () => {
    applyReorderAndSave();
    closeReorderStoresModal();
  });
  document.getElementById('adminReorderStoresList')?.addEventListener('click', (e) => {
    const up = e.target.closest('[data-move-up]');
    const down = e.target.closest('[data-move-down]');
    if (up) {
      const li = up.closest('li');
      if (li?.previousElementSibling) li.parentNode.insertBefore(li, li.previousElementSibling);
    } else if (down) {
      const li = down.closest('li');
      if (li?.nextElementSibling) li.parentNode.insertBefore(li.nextElementSibling, li);
    }
  });
})();

(function tickAdminLoadingProgress() {
  document.querySelectorAll('.admin-loading').forEach(function (el) {
    let start = el.getAttribute('data-loading-start');
    if (!start) {
      start = String(Date.now());
      el.setAttribute('data-loading-start', start);
    }
    const startNum = parseInt(start, 10);
    const p = Math.min(90, ((Date.now() - startNum) / 2000) * 90);
    const bar = el.querySelector('.admin-loading-progress-bar');
    const pct = el.querySelector('.admin-loading-progress-pct');
    if (bar) bar.style.width = p + '%';
    if (pct) pct.textContent = Math.round(p) + '%';
  });
  setTimeout(tickAdminLoadingProgress, 150);
})();

init();
