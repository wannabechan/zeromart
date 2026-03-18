/**
 * 어드민 주문관리/통계관리/정산관리 테스트용 샘플 주문 (DB 미저장)
 * 환경변수 ADMIN_USE_SAMPLE_ORDERS === 'true' 일 때만 사용.
 *
 * 가정:
 * - 사용자-1: 2026-01-15부터 매주 월요일, 1번 매장 첫 메뉴 5개, 결제 완료 → 다음날 11시 발송완료
 * - 사용자-2: 2026-01-15부터 매주 화요일, 2번 매장 첫 메뉴 5개, 동일
 * - 사용자-3: 2026-01-15부터 매주 화요일, 3번 매장 첫 메뉴 5개, 동일
 * - 사용자-4: 2026-01-15부터 매주 목요일, 4번 매장 첫 메뉴 5개 + 5번 매장 첫 메뉴 3개, 동일
 * - 사용자-5: 2026-03-01부터 매일 11:00 KST, 6번 매장(대분류: 테스트매장) 첫 메뉴 5개, 주문일 다음날 11:00 발송완료
 * 현실감: 모든 주문은 주문일 다음날 10시 배송 완료, 11시 주문관리 탭에서 '직접 배송' 발송 완료 처리.
 * 따라서 '오늘(KST)'이 주문일+1일 이후일 때만 status=delivery_completed, 그렇지 않으면 payment_completed.
 */

function getKSTDateStr(date) {
  const kst = new Date(date.getTime() + (date.getTimezoneOffset() * 60000) + (9 * 3600000));
  const y = kst.getFullYear();
  const m = String(kst.getMonth() + 1).padStart(2, '0');
  const d = String(kst.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

/** YYYY-MM-DD 기준 다음날 11:00 KST를 ISO 문자열로 */
function nextDay11KSTISO(dateStr) {
  const [y, m, d] = dateStr.split('-').map(Number);
  const next = new Date(Date.UTC(y, m - 1, d + 1, 2, 0, 0, 0)); // 11:00 KST = 02:00 UTC
  return next.toISOString();
}

/** 오늘(KST) 날짜 문자열 YYYY-MM-DD */
function getTodayKSTDateStr() {
  const now = new Date();
  const kst = new Date(now.getTime() + (now.getTimezoneOffset() * 60000) + (9 * 3600000));
  const y = kst.getFullYear();
  const m = String(kst.getMonth() + 1).padStart(2, '0');
  const d = String(kst.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

/** 2026-01-15부터 오늘(KST)까지의 매주 월요일·화요일·목요일 (1/15 목 → 첫 월 1/19, 첫 화 1/20) */
function getSampleOrderDates() {
  const oneDay = 24 * 60 * 60 * 1000;
  const firstMonday = new Date('2026-01-19T00:00:00.000Z');
  const firstTuesday = new Date('2026-01-20T00:00:00.000Z');
  const firstThursday = new Date('2026-01-15T00:00:00.000Z');
  const now = new Date();
  const kstNow = new Date(now.getTime() + (now.getTimezoneOffset() * 60000) + (9 * 3600000));
  const endDate = new Date(Date.UTC(kstNow.getFullYear(), kstNow.getMonth(), kstNow.getDate(), 0, 0, 0));
  const mondays = [];
  const tuesdays = [];
  const thursdays = [];
  for (let d = new Date(firstMonday.getTime()); d <= endDate; d.setTime(d.getTime() + 7 * oneDay)) {
    mondays.push(getKSTDateStr(d));
  }
  for (let d = new Date(firstTuesday.getTime()); d <= endDate; d.setTime(d.getTime() + 7 * oneDay)) {
    tuesdays.push(getKSTDateStr(d));
  }
  for (let d = new Date(firstThursday.getTime()); d <= endDate; d.setTime(d.getTime() + 7 * oneDay)) {
    thursdays.push(getKSTDateStr(d));
  }
  return { mondays, tuesdays, thursdays };
}

/** 2026-03-01부터 오늘(KST)까지의 매일 날짜 문자열 배열 (YYYY-MM-DD) */
function getSampleOrderDatesDailyFromMarch2026() {
  const oneDay = 24 * 60 * 60 * 1000;
  const start = new Date('2026-03-01T00:00:00.000Z');
  const now = new Date();
  const kstNow = new Date(now.getTime() + (now.getTimezoneOffset() * 60000) + (9 * 3600000));
  const endDate = new Date(Date.UTC(kstNow.getFullYear(), kstNow.getMonth(), kstNow.getDate(), 0, 0, 0));
  const dates = [];
  for (let d = new Date(start.getTime()); d <= endDate; d.setTime(d.getTime() + oneDay)) {
    dates.push(getKSTDateStr(d));
  }
  return dates;
}

/**
 * @param {Array} stores - getStores() 결과 (어드민 등록 순서 = 1번~5번 매장)
 * @param {Object} menusByStore - { [storeId]: menu[] }
 * @returns {Array} 샘플 주문 목록 (created_at 오름차순)
 */
function getSampleOrders(stores, menusByStore) {
  const storeList = Array.isArray(stores) ? stores : [];
  const firstStore = storeList[0];
  const secondStore = storeList[1];
  const thirdStore = storeList[2];
  const fourthStore = storeList[3];
  const fifthStore = storeList[4];
  const sixthStore = storeList[5];
  const menus1 = menusByStore && firstStore ? (menusByStore[firstStore.id] || []) : [];
  const menus2 = menusByStore && secondStore ? (menusByStore[secondStore.id] || []) : [];
  const menus3 = menusByStore && thirdStore ? (menusByStore[thirdStore.id] || []) : [];
  const menus4 = menusByStore && fourthStore ? (menusByStore[fourthStore.id] || []) : [];
  const menus5 = menusByStore && fifthStore ? (menusByStore[fifthStore.id] || []) : [];
  const menus6 = menusByStore && sixthStore ? (menusByStore[sixthStore.id] || []) : [];
  const firstMenu1 = menus1[0];
  const firstMenu2 = menus2[0];
  const firstMenu3 = menus3[0];
  const firstMenu4 = menus4[0];
  const firstMenu5 = menus5[0];
  const firstMenu6 = menus6[0];

  const orders = [];
  const { mondays, tuesdays, thursdays } = getSampleOrderDates();
  const todayKST = getTodayKSTDateStr();

  /** 매장 id → 대분류 표시명. 매장 정보의 '대분류' 입력란(title)에 저장된 값을 사용. */
  function storeDisplayName(store) {
    if (!store) return '';
    return (store.title || store.brand || store.id || '').toString().trim() || (store.id || '');
  }

  /** 주문일(YYYY-MM-DD) 기준: 다음날 11시에 발송완료 처리되므로, 오늘이 배송일 이상이면 delivery_completed */
  function sampleOrderStatusAndDeliveryAt(orderDateStr) {
    const [y, m, d] = orderDateStr.split('-').map(Number);
    const nextDay = new Date(Date.UTC(y, m - 1, d + 1));
    const deliveryDateStr = `${nextDay.getUTCFullYear()}-${String(nextDay.getUTCMonth() + 1).padStart(2, '0')}-${String(nextDay.getUTCDate()).padStart(2, '0')}`;
    const isCompleted = todayKST >= deliveryDateStr;
    return {
      status: isCompleted ? 'delivery_completed' : 'payment_completed',
      delivery_completed_at: isCompleted ? nextDay11KSTISO(orderDateStr) : null,
    };
  }

  // 사용자-1: 매주 월요일, 1번 매장 첫 메뉴 5개
  if (firstStore && firstMenu1) {
    const price = Number(firstMenu1.price) || 0;
    const totalAmount = price * 5;
    const item = {
      id: firstMenu1.id,
      name: firstMenu1.name || firstMenu1.id,
      price,
      quantity: 5,
    };
    const storeDisplayNames = { [firstStore.id]: storeDisplayName(firstStore) };
    mondays.forEach((dateStr) => {
      const { status, delivery_completed_at } = sampleOrderStatusAndDeliveryAt(dateStr);
      const [y, m, d] = dateStr.split('-').map(Number);
      const orderDate = new Date(Date.UTC(y, m - 1, d, 0, 0, 0) - 9 * 3600000);
      const orderDateIso = orderDate.toISOString();
      const yymmdd = dateStr.replace(/-/g, '').slice(2);
      orders.push({
        id: `${yymmdd}001`,
        user_email: 'sample-user1@test.local',
        depositor: '사용자-1',
        contact: '010-0000-0001',
        delivery_address: '서울시 샘플구 샘플로 1',
        detail_address: null,
        order_items: [item],
        total_amount: totalAmount,
        status,
        created_at: orderDateIso,
        payment_completed_at: orderDateIso,
        delivery_completed_at: delivery_completed_at || undefined,
        delivery_type: 'direct',
        courier_company: null,
        tracking_number: null,
        store_display_names: storeDisplayNames,
      });
    });
  }

  // 사용자-2: 매주 화요일, 2번 매장 첫 메뉴 5개
  if (secondStore && firstMenu2) {
    const price = Number(firstMenu2.price) || 0;
    const totalAmount = price * 5;
    const item = {
      id: firstMenu2.id,
      name: firstMenu2.name || firstMenu2.id,
      price,
      quantity: 5,
    };
    const storeDisplayNames = { [secondStore.id]: storeDisplayName(secondStore) };
    tuesdays.forEach((dateStr) => {
      const { status, delivery_completed_at } = sampleOrderStatusAndDeliveryAt(dateStr);
      const [y, m, d] = dateStr.split('-').map(Number);
      const orderDate = new Date(Date.UTC(y, m - 1, d, 0, 0, 0) - 9 * 3600000);
      const orderDateIso = orderDate.toISOString();
      const yymmdd = dateStr.replace(/-/g, '').slice(2);
      orders.push({
        id: `${yymmdd}001`,
        user_email: 'sample-user2@test.local',
        depositor: '사용자-2',
        contact: '010-0000-0002',
        delivery_address: '서울시 샘플구 샘플로 2',
        detail_address: null,
        order_items: [item],
        total_amount: totalAmount,
        status,
        created_at: orderDateIso,
        payment_completed_at: orderDateIso,
        delivery_completed_at: delivery_completed_at || undefined,
        delivery_type: 'direct',
        courier_company: null,
        tracking_number: null,
        store_display_names: storeDisplayNames,
      });
    });
  }

  // 사용자-3: 매주 화요일, 3번 매장 첫 메뉴 5개
  if (thirdStore && firstMenu3) {
    const price = Number(firstMenu3.price) || 0;
    const totalAmount = price * 5;
    const item = {
      id: firstMenu3.id,
      name: firstMenu3.name || firstMenu3.id,
      price,
      quantity: 5,
    };
    const storeDisplayNames = { [thirdStore.id]: storeDisplayName(thirdStore) };
    tuesdays.forEach((dateStr) => {
      const { status, delivery_completed_at } = sampleOrderStatusAndDeliveryAt(dateStr);
      const [y, m, d] = dateStr.split('-').map(Number);
      const orderDate = new Date(Date.UTC(y, m - 1, d, 0, 0, 0) - 9 * 3600000);
      const orderDateIso = orderDate.toISOString();
      const yymmdd = dateStr.replace(/-/g, '').slice(2);
      orders.push({
        id: `${yymmdd}002`,
        user_email: 'sample-user3@test.local',
        depositor: '사용자-3',
        contact: '010-0000-0003',
        delivery_address: '서울시 샘플구 샘플로 3',
        detail_address: null,
        order_items: [item],
        total_amount: totalAmount,
        status,
        created_at: orderDateIso,
        payment_completed_at: orderDateIso,
        delivery_completed_at: delivery_completed_at || undefined,
        delivery_type: 'direct',
        courier_company: null,
        tracking_number: null,
        store_display_names: storeDisplayNames,
      });
    });
  }

  // 사용자-4: 매주 목요일, 4번 매장 첫 메뉴 5개 + 5번 매장 첫 메뉴 3개
  if (fourthStore && firstMenu4 && fifthStore && firstMenu5) {
    const price4 = Number(firstMenu4.price) || 0;
    const price5 = Number(firstMenu5.price) || 0;
    const totalAmount = price4 * 5 + price5 * 3;
    const item4 = {
      id: firstMenu4.id,
      name: firstMenu4.name || firstMenu4.id,
      price: price4,
      quantity: 5,
    };
    const item5 = {
      id: firstMenu5.id,
      name: firstMenu5.name || firstMenu5.id,
      price: price5,
      quantity: 3,
    };
    const storeDisplayNames = {
      [fourthStore.id]: storeDisplayName(fourthStore),
      [fifthStore.id]: storeDisplayName(fifthStore),
    };
    thursdays.forEach((dateStr) => {
      const { status, delivery_completed_at } = sampleOrderStatusAndDeliveryAt(dateStr);
      const [y, m, d] = dateStr.split('-').map(Number);
      const orderDate = new Date(Date.UTC(y, m - 1, d, 0, 0, 0) - 9 * 3600000);
      const orderDateIso = orderDate.toISOString();
      const yymmdd = dateStr.replace(/-/g, '').slice(2);
      orders.push({
        id: `${yymmdd}001`,
        user_email: 'sample-user4@test.local',
        depositor: '사용자-4',
        contact: '010-0000-0004',
        delivery_address: '서울시 샘플구 샘플로 4',
        detail_address: null,
        order_items: [item4, item5],
        total_amount: totalAmount,
        status,
        created_at: orderDateIso,
        payment_completed_at: orderDateIso,
        delivery_completed_at: delivery_completed_at || undefined,
        delivery_type: 'direct',
        courier_company: null,
        tracking_number: null,
        store_display_names: storeDisplayNames,
      });
    });
  }

  // 사용자-5: 2026-03-01부터 매일 11:00 KST, 6번 매장(대분류: 테스트매장) 첫 메뉴 5개, 다음날 11:00 발송완료
  if (sixthStore && firstMenu6) {
    const price6 = Number(firstMenu6.price) || 0;
    const totalAmount = price6 * 5;
    const item6 = {
      id: firstMenu6.id,
      name: firstMenu6.name || firstMenu6.id,
      price: price6,
      quantity: 5,
    };
    const storeDisplayNames = { [sixthStore.id]: storeDisplayName(sixthStore) };
    const dailyDates = getSampleOrderDatesDailyFromMarch2026();
    dailyDates.forEach((dateStr) => {
      const { status, delivery_completed_at } = sampleOrderStatusAndDeliveryAt(dateStr);
      const [y, m, d] = dateStr.split('-').map(Number);
      const orderDateIso = new Date(Date.UTC(y, m - 1, d, 2, 0, 0, 0)).toISOString();
      const yymmdd = dateStr.replace(/-/g, '').slice(2);
      orders.push({
        id: `${yymmdd}005`,
        user_email: 'sample-user5@test.local',
        depositor: '사용자-5',
        contact: '010-0000-0005',
        delivery_address: '서울시 샘플구 샘플로 5',
        detail_address: null,
        order_items: [item6],
        total_amount: totalAmount,
        status,
        created_at: orderDateIso,
        payment_completed_at: orderDateIso,
        delivery_completed_at: delivery_completed_at || undefined,
        delivery_type: 'direct',
        courier_company: null,
        tracking_number: null,
        store_display_names: storeDisplayNames,
      });
    });
  }

  orders.sort((a, b) => new Date(a.created_at) - new Date(b.created_at));
  return orders;
}

module.exports = {
  getSampleOrders,
  getSampleOrderDates,
};
