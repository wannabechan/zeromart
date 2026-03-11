/**
 * 어드민 주문관리/통계관리/정산관리 테스트용 샘플 주문 (DB 미저장)
 * 환경변수 ADMIN_USE_SAMPLE_ORDERS === 'true' 일 때만 사용.
 *
 * 가정:
 * - 사용자-1: 2026-01-15부터 매주 월요일, 1번 매장 첫 메뉴 5개, 결제 완료 → 다음날 11시 발송완료
 * - 사용자-2: 2026-01-15부터 매주 화요일, 2번 매장 첫 메뉴 5개, 동일
 * - 사용자-3: 2026-01-15부터 매주 화요일, 3번 매장 첫 메뉴 5개, 동일
 * - 사용자-4: 2026-01-15부터 매주 목요일, 4번 매장 첫 메뉴 5개 + 5번 매장 첫 메뉴 3개, 동일
 */

function getKSTDateStr(date) {
  const kst = new Date(date.getTime() + (date.getTimezoneOffset() * 60000) + (9 * 3600000));
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
  const menus1 = menusByStore && firstStore ? (menusByStore[firstStore.id] || []) : [];
  const menus2 = menusByStore && secondStore ? (menusByStore[secondStore.id] || []) : [];
  const menus3 = menusByStore && thirdStore ? (menusByStore[thirdStore.id] || []) : [];
  const menus4 = menusByStore && fourthStore ? (menusByStore[fourthStore.id] || []) : [];
  const menus5 = menusByStore && fifthStore ? (menusByStore[fifthStore.id] || []) : [];
  const firstMenu1 = menus1[0];
  const firstMenu2 = menus2[0];
  const firstMenu3 = menus3[0];
  const firstMenu4 = menus4[0];
  const firstMenu5 = menus5[0];

  const orders = [];
  const { mondays, tuesdays, thursdays } = getSampleOrderDates();

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
    mondays.forEach((dateStr) => {
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
        status: 'delivery_completed',
        created_at: orderDateIso,
        payment_completed_at: orderDateIso,
        delivery_type: 'direct',
        courier_company: null,
        tracking_number: null,
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
    tuesdays.forEach((dateStr) => {
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
        status: 'delivery_completed',
        created_at: orderDateIso,
        payment_completed_at: orderDateIso,
        delivery_type: 'direct',
        courier_company: null,
        tracking_number: null,
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
    tuesdays.forEach((dateStr) => {
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
        status: 'delivery_completed',
        created_at: orderDateIso,
        payment_completed_at: orderDateIso,
        delivery_type: 'direct',
        courier_company: null,
        tracking_number: null,
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
    thursdays.forEach((dateStr) => {
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
        status: 'delivery_completed',
        created_at: orderDateIso,
        payment_completed_at: orderDateIso,
        delivery_type: 'direct',
        courier_company: null,
        tracking_number: null,
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
