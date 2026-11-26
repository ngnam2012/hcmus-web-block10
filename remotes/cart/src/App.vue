<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from 'vue';
import {
  BASE_SHIPPING_FEE,
  FREESHIP_THRESHOLD,
  VAT_RATE,
  VIP_GIFT_THRESHOLD,
  formatTimestamp,
  formatVND,
  generateOrderCode
} from '@shoplite/format';

interface CartLineItem {
  sku: string;
  productId: string;
  name: string;
  icon: string;
  variantLabel: string;
  unitPrice: number;
  qty: number;
  maxStock: number;
}

interface AppliedVoucher {
  code: string;
  title: string;
  type: 'percent' | 'fixed' | 'freeship';
  value: number;
  maxDiscount?: number;
  minSubtotal: number;
  minItems?: number;
}

const props = defineProps<{
  ctx: any;
  edition: string;
}>();

const CART_STORAGE_KEY = 'shoplite_cart_items_v1';
const PURCHASED_STORAGE_KEY = 'shoplite_purchased_products_v1';

function loadSavedCart(): CartLineItem[] {
  try {
    const raw = sessionStorage.getItem(CART_STORAGE_KEY);
    if (raw) return JSON.parse(raw);
  } catch {
    // ignore
  }
  return [];
}

const items = ref<CartLineItem[]>(loadSavedCart());
const activeVoucher = ref<AppliedVoucher | null>(null);
const cartWarning = ref<string>('');
const giftWrapEnabled = ref<boolean>(false);

const showCheckoutForm = ref<boolean>(false);
const recipientName = ref<string>(props.ctx?.user?.name || 'Nguyễn Minh Anh');
const recipientPhone = ref<string>('0912345678');
const recipientAddress = ref<string>('124 Nguyễn Văn Cừ, Quận 5, TP.HCM');
const paymentMethod = ref<'COD' | 'VIETQR' | 'WALLET'>('VIETQR');
const formError = ref<string>('');
const isSubmitting = ref<boolean>(false);
const lastReceipt = ref<{
  orderCode: string;
  finalTotal: number;
  itemCount: number;
  paymentMethod: string;
  tokenPreview: string;
  timestamp: string;
} | null>(null);

const isV2 = computed(() => props.edition === 'v2');

const totalQty = computed(() => items.value.reduce((sum, i) => sum + i.qty, 0));
const subtotal = computed(() => items.value.reduce((sum, i) => sum + i.unitPrice * i.qty, 0));

const productDiscount = computed(() => {
  const v = activeVoucher.value;
  if (!v || subtotal.value === 0) return 0;
  if (v.type === 'percent') {
    const raw = Math.round((subtotal.value * v.value) / 100);
    return v.maxDiscount ? Math.min(raw, v.maxDiscount) : raw;
  }
  if (v.type === 'fixed') {
    return Math.min(subtotal.value, v.value);
  }
  return 0;
});

const shippingFee = computed(() => {
  if (items.value.length === 0) return 0;
  if (subtotal.value >= FREESHIP_THRESHOLD) return 0;
  if (activeVoucher.value?.type === 'freeship') return 0;
  return BASE_SHIPPING_FEE;
});

const giftWrapFee = computed(() => {
  if (!isV2.value || !giftWrapEnabled.value || items.value.length === 0) return 0;
  return subtotal.value >= VIP_GIFT_THRESHOLD ? 0 : 25_000;
});

const taxableAmount = computed(() => Math.max(0, subtotal.value - productDiscount.value));
const vatAmount = computed(() => Math.round(taxableAmount.value * VAT_RATE));

const finalTotal = computed(() =>
  Math.max(0, taxableAmount.value + shippingFee.value + giftWrapFee.value + vatAmount.value)
);

const loyaltyPoints = computed(() => Math.floor(finalTotal.value / 10_000));

function persistAndBroadcast() {
  try {
    sessionStorage.setItem(CART_STORAGE_KEY, JSON.stringify(items.value));
  } catch {
    // ignore
  }
  props.ctx.eventBus.emit('cart:updated', {
    items: items.value.map((i) => ({ ...i })),
    totalQty: totalQty.value,
    subtotal: subtotal.value,
    shippingFee: shippingFee.value,
    discount: productDiscount.value,
    finalTotal: finalTotal.value
  });
}

// Kiểm tra tự động điều kiện mã giảm giá khi giỏ hàng thay đổi
watch([subtotal, totalQty], ([newSub, newQty]) => {
  const v = activeVoucher.value;
  if (!v) return;
  const failsSubtotal = newSub < v.minSubtotal;
  const failsMinItems = v.minItems ? newQty < v.minItems : false;
  if (failsSubtotal || failsMinItems) {
    const removedCode = v.code;
    activeVoucher.value = null;
    cartWarning.value = `Mã ${removedCode} đã tự động gỡ do giỏ hàng chưa đủ điều kiện tối thiểu.`;
    props.ctx.eventBus.emit('promo:invalidated', {
      code: removedCode,
      reason: 'Giỏ hàng thay đổi dưới mức tối thiểu'
    });
  }
  persistAndBroadcast();
});

function getTotalQtyForProduct(productId: string) {
  return items.value
    .filter((i) => i.productId === productId)
    .reduce((acc, item) => acc + item.qty, 0);
}

function changeQty(sku: string, delta: number) {
  cartWarning.value = '';
  const target = items.value.find((i) => i.sku === sku);
  if (!target) return;

  if (delta > 0) {
    const productTotalInCart = getTotalQtyForProduct(target.productId);
    if (productTotalInCart + delta > target.maxStock) {
      cartWarning.value = `Sản phẩm "${target.name}" chỉ còn tối đa ${target.maxStock} chiếc trong kho!`;
      return;
    }
  }

  target.qty += delta;
  if (target.qty <= 0) {
    items.value = items.value.filter((i) => i.sku !== sku);
  }
  persistAndBroadcast();
}

function removeItem(sku: string) {
  cartWarning.value = '';
  items.value = items.value.filter((i) => i.sku !== sku);
  persistAndBroadcast();
}

function clearCart() {
  cartWarning.value = '';
  items.value = [];
  activeVoucher.value = null;
  showCheckoutForm.value = false;
  props.ctx.eventBus.emit('promo:removed', {});
  persistAndBroadcast();
}

async function submitCheckout() {
  formError.value = '';
  if (items.value.length === 0) return;

  if (recipientName.value.trim().length < 2) {
    formError.value = 'Vui lòng nhập họ tên người nhận hợp lệ (tối thiểu 2 ký tự).';
    return;
  }
  const phoneClean = recipientPhone.value.trim();
  if (!/^(0|\+84)[35789]\d{8}$/.test(phoneClean)) {
    formError.value = 'Số điện thoại không đúng định dạng Việt Nam (VD: 0912345678).';
    return;
  }
  if (recipientAddress.value.trim().length < 6) {
    formError.value = 'Vui lòng nhập địa chỉ giao hàng chi tiết.';
    return;
  }

  isSubmitting.value = true;
  try {
    const token = props.ctx?.getAccessToken ? await props.ctx.getAccessToken() : 'sl_guest_token';
    await new Promise((r) => setTimeout(r, 350));

    const orderCode = generateOrderCode();
    const purchasedSnapshot = items.value.map((i) => ({ ...i }));
    const finalSnapshot = finalTotal.value;
    const countSnapshot = totalQty.value;

    // Lưu lịch sử sản phẩm đã mua để Remote Reviews xác thực "Đã mua hàng"
    try {
      const prevIds: string[] = JSON.parse(sessionStorage.getItem(PURCHASED_STORAGE_KEY) || '[]');
      const merged = Array.from(new Set([...prevIds, ...purchasedSnapshot.map((i) => i.productId)]));
      sessionStorage.setItem(PURCHASED_STORAGE_KEY, JSON.stringify(merged));
    } catch {
      // ignore
    }

    lastReceipt.value = {
      orderCode,
      finalTotal: finalSnapshot,
      itemCount: countSnapshot,
      paymentMethod: paymentMethod.value,
      tokenPreview: `${String(token).slice(0, 14)}...`,
      timestamp: formatTimestamp(new Date())
    };

    props.ctx.eventBus.emit('order:completed', {
      orderCode,
      items: purchasedSnapshot,
      finalTotal: finalSnapshot,
      voucherCode: activeVoucher.value?.code || null,
      buyer: recipientName.value.trim(),
      paymentMethod: paymentMethod.value
    });

    items.value = [];
    activeVoucher.value = null;
    giftWrapEnabled.value = false;
    showCheckoutForm.value = false;
    persistAndBroadcast();
  } finally {
    isSubmitting.value = false;
  }
}

const unsubscribers: Array<() => void> = [];

onMounted(() => {
  // Đồng bộ trạng thái giỏ hàng ngay khi vừa mount (kể cả sau khi Deploy/Rollback v1 <-> v2)
  persistAndBroadcast();

  unsubscribers.push(
    props.ctx.eventBus.on('cart:add', (payload: any) => {
      cartWarning.value = '';
      lastReceipt.value = null;

      // Đọc cả unitPrice (mới) và price (cũ) theo mẫu Expand–Contract
      const unitPrice = Number(payload.unitPrice ?? payload.price ?? 0);
      const maxStock = Number(payload.maxStock ?? 99);
      const currentProductQty = getTotalQtyForProduct(payload.productId);

      if (currentProductQty + 1 > maxStock) {
        cartWarning.value = `Không thể thêm: "${payload.name}" đã đạt giới hạn tồn kho (${maxStock}).`;
        return;
      }

      const existing = items.value.find((i) => i.sku === payload.sku);
      if (existing) {
        existing.qty += 1;
        existing.unitPrice = unitPrice;
        existing.maxStock = maxStock;
      } else {
        items.value.push({
          sku: payload.sku,
          productId: payload.productId,
          name: payload.name,
          icon: payload.icon || '📦',
          variantLabel: payload.variantLabel || 'Tiêu chuẩn',
          unitPrice,
          qty: 1,
          maxStock
        });
      }
      persistAndBroadcast();
    })
  );

  unsubscribers.push(
    props.ctx.eventBus.on(
      'promo:applied',
      (voucher: AppliedVoucher) => {
        if (!voucher) return;
        if (subtotal.value < voucher.minSubtotal || (voucher.minItems && totalQty.value < voucher.minItems)) {
          return;
        }
        activeVoucher.value = voucher;
        cartWarning.value = '';
        persistAndBroadcast();
      },
      { replay: true }
    )
  );

  unsubscribers.push(
    props.ctx.eventBus.on('promo:removed', () => {
      activeVoucher.value = null;
      persistAndBroadcast();
    })
  );
});

onUnmounted(() => {
  for (const unsub of unsubscribers) unsub();
});
</script>

<template>
  <div class="cart-root">
    <!-- Banner phân biệt trực quan giữa v1.0 và v2.0 khi demo Independent Deploy / Instant Rollback -->
    <div v-if="isV2" class="cart-v2-banner">
      <div>
        <strong>🚀 Cart v2.0 (Flash Release)</strong>
        <span>Đã bổ sung Gói quà VIP &amp; Thanh toán nhanh VietQR</span>
      </div>
      <span class="cart-v2-pill">LIVE v2</span>
    </div>

    <div v-if="cartWarning" class="cart-alert cart-alert-warn">
      ⚠️ {{ cartWarning }}
    </div>

    <div v-if="lastReceipt" class="cart-receipt">
      <div class="cart-receipt-head">
        <strong>🎉 Đặt hàng thành công!</strong>
        <span>{{ lastReceipt.orderCode }}</span>
      </div>
      <p>
        Tổng thanh toán: <strong>{{ formatVND(lastReceipt.finalTotal) }}</strong> ({{
          lastReceipt.itemCount
        }}
        sản phẩm • {{ lastReceipt.paymentMethod }})
      </p>
      <small>
        Xác thực qua Shell Auth ({{ lastReceipt.tokenPreview }}) lúc {{ lastReceipt.timestamp }}.
        Bạn đã có thể viết đánh giá <strong>"Đã mua hàng"</strong> ở khung dưới!
      </small>
    </div>

    <div v-if="items.length === 0" class="cart-empty">
      <div class="cart-empty-icon">🛒</div>
      <p>Giỏ hàng đang trống</p>
      <small>Hãy chọn sản phẩm từ danh mục React bên trái để bắt đầu tính toán đơn hàng.</small>
    </div>

    <template v-else>
      <ul class="cart-list">
        <li v-for="item in items" :key="item.sku" class="cart-item">
          <div class="cart-item-info">
            <span class="cart-item-icon">{{ item.icon }}</span>
            <div>
              <div class="cart-item-name">{{ item.name }}</div>
              <div class="cart-item-meta">
                {{ item.variantLabel }} • {{ formatVND(item.unitPrice) }}
              </div>
            </div>
          </div>

          <div class="cart-item-actions">
            <div class="cart-qty-box">
              <button type="button" class="cart-qty-btn" @click="changeQty(item.sku, -1)">−</button>
              <span class="cart-qty-num">{{ item.qty }}</span>
              <button type="button" class="cart-qty-btn" @click="changeQty(item.sku, 1)">+</button>
            </div>
            <div class="cart-line-total">{{ formatVND(item.unitPrice * item.qty) }}</div>
            <button
              type="button"
              class="cart-remove-btn"
              title="Xóa sản phẩm"
              @click="removeItem(item.sku)"
            >
              ✕
            </button>
          </div>
        </li>
      </ul>

      <!-- Tính năng mới chỉ xuất hiện ở bản Deploy v2.0 -->
      <label v-if="isV2" class="cart-gift-option">
        <input v-model="giftWrapEnabled" type="checkbox" />
        <span>
          🎁 Gói quà hộp cứng &amp; thiệp viết tay
          <strong>{{
            subtotal >= VIP_GIFT_THRESHOLD ? '(Miễn phí đơn VIP)' : '(+25.000 ₫)'
          }}</strong>
        </span>
      </label>

      <div class="cart-summary">
        <div class="cart-row">
          <span>Tạm tính ({{ totalQty }} món):</span>
          <strong>{{ formatVND(subtotal) }}</strong>
        </div>

        <div v-if="activeVoucher" class="cart-row cart-row-discount">
          <span>
            Voucher <code>{{ activeVoucher.code }}</code>:
          </span>
          <strong>
            {{
              activeVoucher.type === 'freeship'
                ? 'Miễn phí ship'
                : `−${formatVND(productDiscount)}`
            }}
          </strong>
        </div>

        <div class="cart-row">
          <span>Phí vận chuyển:</span>
          <strong :class="{ 'is-free': shippingFee === 0 }">
            {{ shippingFee === 0 ? '0 ₫ (Freeship)' : formatVND(shippingFee) }}
          </strong>
        </div>

        <div v-if="isV2 && giftWrapEnabled" class="cart-row">
          <span>Dịch vụ gói quà:</span>
          <strong>{{ giftWrapFee === 0 ? '0 ₫ (Tặng VIP)' : formatVND(giftWrapFee) }}</strong>
        </div>

        <div class="cart-row">
          <span>Thuế VAT (8%):</span>
          <span>{{ formatVND(vatAmount) }}</span>
        </div>

        <div class="cart-row cart-row-total">
          <span>Tổng thanh toán:</span>
          <span class="cart-total-price">{{ formatVND(finalTotal) }}</span>
        </div>

        <div class="cart-loyalty">
          ✨ Tích lũy thêm <strong>+{{ loyaltyPoints }} điểm</strong> thành viên ShopLite
        </div>
      </div>

      <div class="cart-footer-btns">
        <button type="button" class="cart-btn-secondary" @click="clearCart">Xóa giỏ</button>
        <button
          type="button"
          class="cart-btn-primary"
          @click="showCheckoutForm = !showCheckoutForm"
        >
          {{ showCheckoutForm ? 'Ẩn biểu mẫu' : 'Tiến hành đặt hàng →' }}
        </button>
      </div>

      <form v-if="showCheckoutForm" class="cart-checkout-form" @submit.prevent="submitCheckout">
        <h4>Thông tin giao hàng &amp; Thanh toán</h4>

        <div v-if="formError" class="cart-alert cart-alert-error">{{ formError }}</div>

        <div class="cart-field">
          <label>Người nhận</label>
          <input v-model="recipientName" type="text" placeholder="Họ và tên" />
        </div>

        <div class="cart-field">
          <label>Số điện thoại (VN)</label>
          <input v-model="recipientPhone" type="tel" placeholder="0912345678" />
        </div>

        <div class="cart-field">
          <label>Địa chỉ nhận hàng</label>
          <input v-model="recipientAddress" type="text" placeholder="Số nhà, đường, quận/huyện" />
        </div>

        <div class="cart-field">
          <label>Phương thức thanh toán</label>
          <select v-model="paymentMethod">
            <option value="VIETQR">Chuyển khoản nhanh VietQR</option>
            <option value="COD">Thanh toán khi nhận hàng (COD)</option>
            <option value="WALLET">Ví điện tử ShopLite Pay</option>
          </select>
        </div>

        <div v-if="isV2 && paymentMethod === 'VIETQR'" class="cart-qr-preview">
          <span>📱 <strong>VietQR v2 Instant:</strong> Tự động điền nội dung &amp; số tiền {{ formatVND(finalTotal) }}</span>
        </div>

        <button type="submit" class="cart-submit-order" :disabled="isSubmitting">
          {{ isSubmitting ? 'Đang xác thực & xử lý...' : `Xác nhận thanh toán ${formatVND(finalTotal)}` }}
        </button>
      </form>
    </template>
  </div>
</template>

<style scoped>
.cart-root {
  font-family: var(--sl-font-sans, system-ui, sans-serif);
  color: var(--sl-text-primary, #0f172a);
}

.cart-v2-banner {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding: 9px 12px;
  margin-bottom: 12px;
  border-radius: 10px;
  background: linear-gradient(135deg, rgba(124, 58, 237, 0.14), rgba(37, 99, 235, 0.14));
  border: 1px solid rgba(124, 58, 237, 0.35);
  font-size: 0.76rem;
}

.cart-v2-banner strong {
  display: block;
  color: #6d28d9;
  font-size: 0.8rem;
}

.cart-v2-pill {
  background: #7c3aed;
  color: #fff;
  padding: 2px 8px;
  border-radius: 999px;
  font-weight: 700;
  font-size: 0.68rem;
  flex-shrink: 0;
}

.cart-alert {
  padding: 8px 10px;
  border-radius: 8px;
  font-size: 0.78rem;
  margin-bottom: 10px;
}

.cart-alert-warn {
  background: rgba(245, 158, 11, 0.14);
  border: 1px solid rgba(245, 158, 11, 0.4);
  color: #b45309;
}

.cart-alert-error {
  background: rgba(239, 68, 68, 0.12);
  border: 1px solid rgba(239, 68, 68, 0.35);
  color: #dc2626;
}

.cart-receipt {
  padding: 12px;
  margin-bottom: 12px;
  border-radius: 10px;
  background: rgba(16, 185, 129, 0.12);
  border: 1px solid rgba(16, 185, 129, 0.38);
  font-size: 0.8rem;
}

.cart-receipt-head {
  display: flex;
  justify-content: space-between;
  margin-bottom: 4px;
  color: #047857;
}

.cart-receipt p {
  margin: 4px 0;
}

.cart-receipt small {
  color: var(--sl-text-secondary, #475569);
  line-height: 1.35;
  display: block;
}

.cart-empty {
  text-align: center;
  padding: 26px 12px;
  border: 1px dashed var(--sl-border, #cbd5e1);
  border-radius: 10px;
  color: var(--sl-text-secondary, #64748b);
}

.cart-empty-icon {
  font-size: 2rem;
  margin-bottom: 6px;
}

.cart-empty p {
  margin: 0 0 4px;
  font-weight: 700;
  color: var(--sl-text-primary, #0f172a);
}

.cart-list {
  list-style: none;
  padding: 0;
  margin: 0 0 12px;
  display: flex;
  flex-direction: column;
  gap: 8px;
  max-height: 280px;
  overflow-y: auto;
}

.cart-item {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 8px;
  padding: 9px 10px;
  border-radius: 9px;
  background: var(--sl-surface-subtle, #f8fafc);
  border: 1px solid var(--sl-border, #e2e8f0);
}

.cart-item-info {
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
}

.cart-item-icon {
  font-size: 1.2rem;
}

.cart-item-name {
  font-size: 0.81rem;
  font-weight: 700;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  max-width: 175px;
}

.cart-item-meta {
  font-size: 0.72rem;
  color: var(--sl-text-secondary, #64748b);
}

.cart-item-actions {
  display: flex;
  align-items: center;
  gap: 7px;
  flex-shrink: 0;
}

.cart-qty-box {
  display: inline-flex;
  align-items: center;
  border: 1px solid var(--sl-border, #cbd5e1);
  border-radius: 6px;
  background: var(--sl-surface, #ffffff);
}

.cart-qty-btn {
  border: none;
  background: transparent;
  color: var(--sl-text-primary, #0f172a);
  width: 24px;
  height: 24px;
  cursor: pointer;
  font-weight: 700;
}

.cart-qty-num {
  font-size: 0.78rem;
  font-weight: 700;
  min-width: 20px;
  text-align: center;
}

.cart-line-total {
  font-size: 0.8rem;
  font-weight: 700;
  min-width: 78px;
  text-align: right;
}

.cart-remove-btn {
  border: none;
  background: transparent;
  color: #ef4444;
  cursor: pointer;
  font-size: 0.8rem;
  padding: 2px 4px;
}

.cart-gift-option {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 10px;
  margin-bottom: 10px;
  border-radius: 8px;
  background: rgba(124, 58, 237, 0.08);
  border: 1px dashed rgba(124, 58, 237, 0.35);
  font-size: 0.77rem;
  cursor: pointer;
}

.cart-summary {
  padding: 12px;
  border-radius: 10px;
  background: var(--sl-surface-subtle, #f8fafc);
  border: 1px solid var(--sl-border, #e2e8f0);
  margin-bottom: 12px;
}

.cart-row {
  display: flex;
  justify-content: space-between;
  font-size: 0.8rem;
  margin-bottom: 6px;
}

.cart-row-discount {
  color: #059669;
}

.is-free {
  color: #059669;
}

.cart-row-total {
  margin-top: 8px;
  padding-top: 8px;
  border-top: 1px solid var(--sl-border, #cbd5e1);
  font-size: 0.92rem;
  font-weight: 800;
}

.cart-total-price {
  color: var(--sl-primary, #2563eb);
  font-size: 1.05rem;
}

.cart-loyalty {
  margin-top: 6px;
  font-size: 0.73rem;
  color: var(--sl-text-secondary, #64748b);
  text-align: right;
}

.cart-footer-btns {
  display: flex;
  gap: 8px;
}

.cart-btn-secondary {
  padding: 9px 12px;
  border-radius: 8px;
  border: 1px solid var(--sl-border, #cbd5e1);
  background: var(--sl-surface, #ffffff);
  color: var(--sl-text-secondary, #475569);
  font-size: 0.8rem;
  font-weight: 600;
  cursor: pointer;
}

.cart-btn-primary {
  flex: 1;
  padding: 9px 14px;
  border-radius: 8px;
  border: none;
  background: #10b981;
  color: #ffffff;
  font-size: 0.82rem;
  font-weight: 700;
  cursor: pointer;
}

.cart-checkout-form {
  margin-top: 12px;
  padding: 12px;
  border-radius: 10px;
  border: 1px solid var(--sl-border, #cbd5e1);
  background: var(--sl-surface, #ffffff);
}

.cart-checkout-form h4 {
  margin: 0 0 10px;
  font-size: 0.86rem;
}

.cart-field {
  margin-bottom: 8px;
}

.cart-field label {
  display: block;
  font-size: 0.73rem;
  font-weight: 600;
  margin-bottom: 3px;
  color: var(--sl-text-secondary, #475569);
}

.cart-field input,
.cart-field select {
  width: 100%;
  box-sizing: border-box;
  padding: 7px 9px;
  border-radius: 7px;
  border: 1px solid var(--sl-border, #cbd5e1);
  background: var(--sl-surface-subtle, #f8fafc);
  color: var(--sl-text-primary, #0f172a);
  font-size: 0.8rem;
}

.cart-qr-preview {
  padding: 8px 10px;
  margin-bottom: 8px;
  border-radius: 7px;
  background: rgba(37, 99, 235, 0.1);
  color: var(--sl-primary, #2563eb);
  font-size: 0.75rem;
}

.cart-submit-order {
  width: 100%;
  padding: 10px;
  border: none;
  border-radius: 8px;
  background: var(--sl-primary, #2563eb);
  color: #ffffff;
  font-weight: 700;
  font-size: 0.83rem;
  cursor: pointer;
}

.cart-submit-order:disabled {
  opacity: 0.6;
  cursor: wait;
}
</style>
