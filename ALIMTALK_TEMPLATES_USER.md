# 손님(고객)용 알림톡 템플릿 예시

NHN Cloud 콘솔에서 템플릿 등록 시 아래 문구와 치환자를 사용하세요.  
환경 변수에 템플릿 코드를 넣으면 됩니다.

---

## 1. 신규 주문 완료 (NHN_ALIMTALK_TEMPLATE_CODE_USER_NEW_ORDER)

**발송 시점:** 주문 신청이 완료되었을 때

**치환자:** `#{orderId}`, `#{storeName}`, `#{totalAmount}`, `#{deliveryDate}`

**예시 문구:**
```
[BzCat] 주문이 접수되었습니다.
주문번호: #{orderId}
매장: #{storeName}
결제 예정 금액: #{totalAmount}
배송 희망일: #{deliveryDate}
```

---

## 2. 주문 취소 (NHN_ALIMTALK_TEMPLATE_CODE_USER_CANCEL_ORDER)

**발송 시점:** 어떠한 이유로든 주문이 취소되었을 때

**치환자:** `#{orderId}`, `#{cancelReason}`

**예시 문구:**
```
[BzCat] 주문이 취소되었습니다.
주문번호: #{orderId}
취소 사유: #{cancelReason}
```

---

## 3. 결제 요청 (결제 링크 발급) (NHN_ALIMTALK_TEMPLATE_CODE_USER_PAYASK_ORDER)

**발송 시점:** 결제 링크가 생성되어 결제를 요청할 때

**치환자:** `#{orderId}`, `#{totalAmount}`, `#{deliveryDate}`, `#{paymentUrl}` (결제 링크 URL – 버튼/링크용)

**예시 문구:**
```
[BzCat] 결제 안내
주문번호: #{orderId}
결제 금액: #{totalAmount}
배송 희망일: #{deliveryDate}
아래 링크에서 결제를 진행해 주세요.
```

※ `#{paymentUrl}` 은 알림톡 버튼/링크로 넣는 경우가 많습니다. 템플릿에 버튼 타입으로 등록하세요.

---

## 4. 결제 완료 (NHN_ALIMTALK_TEMPLATE_CODE_USER_PAYDONE_ORDER)

**발송 시점:** 정상적으로 결제가 완료되었을 때

**치환자:** `#{orderId}`, `#{totalAmount}`, `#{deliveryDate}`

**예시 문구:**
```
[BzCat] 결제가 완료되었습니다.
주문번호: #{orderId}
결제 금액: #{totalAmount}
배송 희망일: #{deliveryDate}
```

---

## 5. 배송 준비 (배송 1일 전) (NHN_ALIMTALK_TEMPLATE_CODE_USER_PREPARE_ORDER)

**발송 시점:** 배송 희망일 1일 전 11:00(KST)

**치환자:** `#{orderId}`, `#{deliveryDate}`, `#{deliveryTime}`

**예시 문구:**
```
[BzCat] 내일 배송 예정입니다.
주문번호: #{orderId}
배송 예정일: #{deliveryDate}
배송 시간: #{deliveryTime}
```

---

## 6. 배송 중 (송장 입력 시) (NHN_ALIMTALK_TEMPLATE_CODE_USER_GOING_ORDER)

**발송 시점:** 어드민에서 배송(송장) 번호를 입력하였을 때

**치환자:** `#{orderId}`, `#{trackingNumber}`, `#{deliveryDate}`

**예시 문구:**
```
[BzCat] 주문이 배송 중입니다.
주문번호: #{orderId}
배송 희망일: #{deliveryDate}
송장번호: #{trackingNumber}
```

---

## 7. 배송 완료 하루 후 인사 (NHN_ALIMTALK_TEMPLATE_CODE_USER_AS_ORDER)

**발송 시점:** 배송 희망일 기준 하루 다음 날 (크론에서 일 1회 발송)

**치환자:** `#{depositor}` (문구에 사용. `#{orderId}`, `#{storeName}`는 코드에서 전달되며 템플릿에 넣을 경우에만 사용)

**예시 문구:**
```
[BzCat] 안녕하세요, #{depositor}님. BzCat의 단체 식사 배송 잘 받으셨는지요? 맛있는 식사 시간 되셨길 바랍니다. 오늘도 행복한 하루 되시길 바라며, 다음에 또 뵐게요. 고맙습니다. 🙂
```

※ NHN 콘솔에 위 문구와 치환자로 템플릿을 등록한 뒤, 환경 변수 `NHN_ALIMTALK_TEMPLATE_CODE_USER_AS_ORDER`에 템플릿 코드를 넣으세요. Vercel Cron `0 2 * * *`(매일 02:00 UTC = 11:00 KST)에 `/api/cron/alimtalk-user-as-order`가 호출됩니다.

---

## 환경 변수 (Vercel / .env.local)

| 변수명 | 설명 |
|--------|------|
| `NHN_ALIMTALK_TEMPLATE_CODE_USER_NEW_ORDER` | 신규 주문 완료 템플릿 코드 |
| `NHN_ALIMTALK_TEMPLATE_CODE_USER_CANCEL_ORDER` | 주문 취소 템플릿 코드 |
| `NHN_ALIMTALK_TEMPLATE_CODE_USER_PAYASK_ORDER` | 결제 요청(링크 발급) 템플릿 코드 |
| `NHN_ALIMTALK_TEMPLATE_CODE_USER_PAYDONE_ORDER` | 결제 완료 템플릿 코드 |
| `NHN_ALIMTALK_TEMPLATE_CODE_USER_PREPARE_ORDER` | 배송 1일 전 알림 템플릿 코드 |
| `NHN_ALIMTALK_TEMPLATE_CODE_USER_GOING_ORDER` | 배송 중(송장 입력) 템플릿 코드 |
| `NHN_ALIMTALK_TEMPLATE_CODE_USER_AS_ORDER` | 배송 완료 하루 후 인사 템플릿 코드 |

수신 번호는 주문 시 입력한 **연락처(contact)** 또는 **주문자 이메일로 조회한 주문의 contact** 로 발송하면 됩니다.
