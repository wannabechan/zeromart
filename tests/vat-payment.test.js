/**
 * 부가세 자료관리 유틸 단위 테스트
 */
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const {
  allocateProportionalNets,
  classifyTossPaymentBuckets,
  scaleBuckets,
  sumBuckets,
} = require('../api/payment/_vatPayment');

describe('allocateProportionalNets', () => {
  it('비율 안분 후 합이 총액-할인과 같다', () => {
    const nets = allocateProportionalNets([7000, 3000], 1000);
    assert.equal(nets.reduce((a, b) => a + b, 0), 9000);
    assert.equal(nets[0], 6300);
    assert.equal(nets[1], 2700);
  });
});

describe('classifyTossPaymentBuckets', () => {
  it('등록 카드는 D, 충전은 F(지출증빙), 적립은 H', () => {
    const { buckets } = classifyTossPaymentBuckets({
      totalAmount: 15000,
      method: '간편결제',
      card: { amount: 10000 },
      easyPay: { provider: '네이버페이', amount: 3000, discountAmount: 2000 },
      cashReceipt: { type: '지출증빙', amount: 3000 },
    });
    assert.equal(buckets.d, 10000);
    assert.equal(buckets.f, 3000);
    assert.equal(buckets.h, 2000);
    assert.equal(sumBuckets(buckets), 15000);
  });

  it('충전식 + 영수증 없으면 G', () => {
    const { buckets } = classifyTossPaymentBuckets({
      totalAmount: 5000,
      method: '간편결제',
      card: null,
      easyPay: { provider: '카카오페이', amount: 5000, discountAmount: 0 },
    });
    assert.equal(buckets.g, 5000);
    assert.equal(buckets.d, 0);
  });
});

describe('scaleBuckets', () => {
  it('브랜드 안분 시 합이 총액×비율과 같다', () => {
    const scaled = scaleBuckets({ d: 10000, e: 0, f: 0, g: 0, h: 0 }, 3, 10);
    assert.equal(sumBuckets(scaled), 3000);
  });
});
