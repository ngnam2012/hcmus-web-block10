/**
 * @shoplite/format (v1)
 * Thư viện định dạng tiền tệ, ngày giờ và hằng số nghiệp vụ dùng chung qua Import Map.
 * Không phụ thuộc bất kỳ UI framework nào.
 */

const MODULE_LOAD_ID = `fmt-${Math.random().toString(36).slice(2, 8)}`;

export const SHARED_FORMAT_VERSION = `1.0.0 (${MODULE_LOAD_ID})`;

export const FREESHIP_THRESHOLD = 1_500_000;
export const VIP_GIFT_THRESHOLD = 3_000_000;
export const BASE_SHIPPING_FEE = 35_000;
export const VAT_RATE = 0.08;

/**
 * Định dạng tiền Việt Nam Đồng (VD: 1.250.000 ₫)
 * @param {number} amount
 */
export function formatVND(amount) {
  const safe = Number.isFinite(amount) ? Math.round(amount) : 0;
  return new Intl.NumberFormat('vi-VN', {
    style: 'currency',
    currency: 'VND',
    maximumFractionDigits: 0
  }).format(safe);
}

/**
 * Định dạng phần trăm gọn gàng
 * @param {number} ratio
 */
export function formatPercent(ratio) {
  return `${Math.round(Math.max(0, Math.min(100, ratio)))}%`;
}

/**
 * Định dạng thời gian ngắn gọn (HH:mm:ss - DD/MM)
 * @param {string | number | Date} input
 */
export function formatTimestamp(input = new Date()) {
  const d = input instanceof Date ? input : new Date(input);
  return d.toLocaleString('vi-VN', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    day: '2-digit',
    month: '2-digit'
  });
}

/**
 * Sinh mã đơn hàng chuẩn ShopLite
 */
export function generateOrderCode() {
  const rand = Math.random().toString(36).substring(2, 6).toUpperCase();
  const timePart = Date.now().toString().slice(-4);
  return `SL-${timePart}-${rand}`;
}
