/**
 * 주문 슬립(매장별) 배송 표시 — admin / store-orders / brand-manager / app 공용
 * 각 페이지에서 escapeHtml 구현을 넘겨 사용합니다.
 */
(function (w) {
  'use strict';

  function formatOneSlipLineClient(slip, orderId) {
    var id = String(orderId || '');
    var num = slip.slipIndex != null ? slip.slipIndex : 1;
    var st = slip.delivery_status || slip.deliveryStatus;
    if (st !== 'delivery_completed') return '#' + id + '-' + num + ': 미입력';
    var dt = slip.delivery_type || slip.deliveryType;
    if (dt === 'direct') return '#' + id + '-' + num + ': 직접 배송 완료';
    var cc = String(slip.courier_company || slip.courierCompany || '').trim();
    var tn = String(slip.tracking_number || slip.trackingNumber || '').trim();
    if (cc || tn) return '#' + id + '-' + num + ': ' + (cc || '—') + ' / ' + tn;
    return '#' + id + '-' + num + ': 미입력';
  }

  function formatOrderSlipLinesHtml(order, escapeHtml) {
    var id = String(order.id || '');
    var slips = order.order_slips || order.orderSlips;
    if (Array.isArray(slips) && slips.length > 0) {
      return slips.map(function (s) {
        return (
          '<div class="admin-payment-delivery-slip-line"><span class="admin-payment-delivery-info">*배송정보 : ' +
          escapeHtml(formatOneSlipLineClient(s, id)) +
          '</span></div>'
        );
      }).join('');
    }
    if (order.status === 'delivery_completed') {
      var cc = String(order.courier_company || '').trim();
      var tn = String(order.tracking_number || '').trim();
      var hasParcel = !!cc || !!tn;
      var text;
      if (order.delivery_type === 'direct') text = '직접 배송 완료';
      else if (hasParcel) text = (cc || '—') + ' / ' + tn;
      else text = '배송 정보 없음';
      return (
        '<div class="admin-payment-delivery-slip-line"><span class="admin-payment-delivery-info">*배송정보 : ' +
        escapeHtml(text) +
        '</span></div>'
      );
    }
    return '';
  }

  /** 마이페이지 모달용: 줄바꿈으로 이어 붙일 문자열 */
  function formatDeliveryModalLines(order) {
    var slips = order.orderSlips || order.order_slips;
    if (!Array.isArray(slips) || slips.length === 0) return null;
    var oid = String(order.id || '');
    return slips
      .map(function (s) {
        return '*배송정보 : ' + formatOneSlipLineClient(s, oid);
      })
      .join('\n');
  }

  w.OrderSlipsDisplay = {
    formatOneSlipLineClient: formatOneSlipLineClient,
    formatOrderSlipLinesHtml: formatOrderSlipLinesHtml,
    formatDeliveryModalLines: formatDeliveryModalLines,
  };
})(typeof window !== 'undefined' ? window : this);
