import { formatTimestamp } from '@shoplite/format';

interface ProductRef {
  id: string;
  name: string;
  icon: string;
  rating: number;
  reviewCount: number;
}

interface ReviewRecord {
  id: string;
  productId: string;
  author: string;
  stars: number;
  tags: string[];
  comment: string;
  verifiedPurchase: boolean;
  helpfulCount: number;
  upvotedByMe?: boolean;
  createdAt: string;
}

const DEFAULT_PRODUCTS: ProductRef[] = [
  { id: 'p1', name: 'Chuột Logitech Pebble 2 M350s Silent', icon: '🖱️', rating: 4.8, reviewCount: 24 },
  { id: 'p2', name: 'Bàn phím cơ Royal Kludge RK75 Wireless', icon: '⌨️', rating: 4.9, reviewCount: 31 },
  { id: 'p3', name: 'Tai nghe Anker Soundcore Space One ANC', icon: '🎧', rating: 4.7, reviewCount: 18 },
  { id: 'p4', name: 'Đèn treo màn hình Xiaomi Light Bar Pro', icon: '💡', rating: 4.8, reviewCount: 29 },
  { id: 'p5', name: 'Hub USB-C Ugreen Revodok Pro 7-in-1', icon: '🔌', rating: 4.6, reviewCount: 15 },
  { id: 'p6', name: 'Loa kiểm âm Edifier MR4 Studio Monitor', icon: '🔊', rating: 4.9, reviewCount: 22 }
];

const SEED_REVIEWS: ReviewRecord[] = [
  {
    id: 'r1',
    productId: 'p1',
    author: 'Trần Hoàng Nam',
    stars: 5,
    tags: ['Click siêu êm', 'Kết nối nhanh'],
    comment: 'Dùng trong văn phòng cực thích vì gần như không phát tiếng click, chuyển giữa Mac và iPad rất nhạy.',
    verifiedPurchase: true,
    helpfulCount: 7,
    createdAt: '09:15 24/11'
  },
  {
    id: 'r2',
    productId: 'p1',
    author: 'Lê Thu Hà',
    stars: 4,
    tags: ['Nhỏ gọn', 'Pin trâu'],
    comment: 'Dáng chuột mỏng đẹp, bỏ túi chống sốc rất gọn, hợp tay nữ hơn tay to.',
    verifiedPurchase: true,
    helpfulCount: 3,
    createdAt: '14:40 23/11'
  },
  {
    id: 'r3',
    productId: 'p2',
    author: 'Phạm Quốc Bảo',
    stars: 5,
    tags: ['Âm gõ creamy', 'Núm xoay tiện'],
    comment: 'Gasket mount nhún êm bất ngờ trong tầm giá dưới 1 triệu, núm vặn âm lượng nhôm CNC rất đầm.',
    verifiedPurchase: true,
    helpfulCount: 11,
    createdAt: '20:05 24/11'
  },
  {
    id: 'r4',
    productId: 'p3',
    author: 'Đặng Khánh Linh',
    stars: 5,
    tags: ['Chống ồn tốt', 'Đeo êm tai'],
    comment: 'Bật ANC ngoài quán cà phê lọc được hầu hết tiếng ồn điều hòa và xe cộ, pin nghe cả tuần chưa hết.',
    verifiedPurchase: true,
    helpfulCount: 6,
    createdAt: '11:22 22/11'
  }
];

const QUICK_TAGS = ['Đóng gói kỹ', 'Hoàn thiện tốt', 'Đáng tầm giá', 'Giao hàng nhanh'];
const PURCHASED_STORAGE_KEY = 'shoplite_purchased_products_v1';
const REVIEWS_STORAGE_KEY = 'shoplite_reviews_records_v1';

function escapeHtml(str: string): string {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export class ShopLiteReviewHub extends HTMLElement {
  private shadow: ShadowRoot;
  private ctx: any = null;
  private unsubscribers: Array<() => void> = [];

  private products: ProductRef[] = [...DEFAULT_PRODUCTS];
  private activeProductId = 'p1';
  private reviews: ReviewRecord[] = [];
  private purchasedIds = new Set<string>();

  private filterMode: 'all' | '5star' | 'verified' = 'all';
  private draftStars = 5;
  private draftTags = new Set<string>(['Đáng tầm giá']);
  private draftComment = '';
  private formFeedback = '';
  private formFeedbackError = false;
  private aggressiveCssTest = false;

  constructor() {
    super();
    this.shadow = this.attachShadow({ mode: 'open' });
    this.loadState();
  }

  private loadState() {
    try {
      const savedReviews = sessionStorage.getItem(REVIEWS_STORAGE_KEY);
      this.reviews = savedReviews ? JSON.parse(savedReviews) : [...SEED_REVIEWS];
    } catch {
      this.reviews = [...SEED_REVIEWS];
    }

    try {
      const savedPurchased = JSON.parse(sessionStorage.getItem(PURCHASED_STORAGE_KEY) || '[]');
      this.purchasedIds = new Set(savedPurchased);
    } catch {
      this.purchasedIds = new Set();
    }
  }

  private saveReviews() {
    try {
      sessionStorage.setItem(REVIEWS_STORAGE_KEY, JSON.stringify(this.reviews));
    } catch {
      // ignore
    }
  }

  public setContext(ctx: any) {
    this.ctx = ctx;
    this.cleanupListeners();

    this.unsubscribers.push(
      ctx.eventBus.on(
        'catalog:ready',
        (payload: any) => {
          if (Array.isArray(payload?.products) && payload.products.length > 0) {
            this.products = payload.products;
            this.render();
          }
        },
        { replay: true }
      )
    );

    this.unsubscribers.push(
      ctx.eventBus.on(
        'product:select',
        (payload: any) => {
          if (payload?.productId) {
            this.activeProductId = payload.productId;
            this.formFeedback = '';
            this.render();
          }
        },
        { replay: true }
      )
    );

    this.unsubscribers.push(
      ctx.eventBus.on('order:completed', (payload: any) => {
        for (const item of payload?.items || []) {
          this.purchasedIds.add(item.productId);
        }
        this.render();
      })
    );

    this.render();
  }

  public disconnectedCallback() {
    this.cleanupListeners();
  }

  private cleanupListeners() {
    for (const u of this.unsubscribers) u();
    this.unsubscribers = [];
  }

  private getActiveProduct(): ProductRef {
    return this.products.find((p) => p.id === this.activeProductId) || this.products[0];
  }

  private getProductReviews(productId: string): ReviewRecord[] {
    return this.reviews.filter((r) => r.productId === productId);
  }

  private computeStats(product: ProductRef) {
    const prodReviews = this.getProductReviews(product.id);
    const seedCountForProduct = SEED_REVIEWS.filter((r) => r.productId === product.id).length;
    const extraReviews = prodReviews.slice(0, Math.max(0, prodReviews.length - seedCountForProduct));

    // Kết hợp đánh giá nền tảng với các đánh giá mới người dùng vừa gửi
    const baseCount = product.reviewCount;
    const baseTotalScore = product.rating * baseCount;

    if (extraReviews.length === 0) {
      return {
        avg: product.rating,
        count: baseCount,
        histogram: this.computeHistogram(prodReviews)
      };
    }

    const addedScore = extraReviews.reduce((s, r) => s + r.stars, 0);
    const totalCount = baseCount - extraReviews.length + extraReviews.length;
    // Khi đã đồng bộ sang React thì product.reviewCount đã tăng, nên tính chuẩn từ gốc:
    const initialBase = DEFAULT_PRODUCTS.find((d) => d.id === product.id) || product;
    const newCount = initialBase.reviewCount + extraReviews.length;
    const newAvg = Number(
      ((initialBase.rating * initialBase.reviewCount + addedScore) / newCount).toFixed(1)
    );

    return {
      avg: newAvg,
      count: newCount,
      histogram: this.computeHistogram(prodReviews)
    };
  }

  private computeHistogram(list: ReviewRecord[]) {
    const counts: Record<number, number> = { 5: 0, 4: 0, 3: 0, 2: 0, 1: 0 };
    if (list.length === 0) {
      return { 5: 75, 4: 20, 3: 5, 2: 0, 1: 0 };
    }
    for (const r of list) {
      counts[r.stars] = (counts[r.stars] || 0) + 1;
    }
    const pct: Record<number, number> = {};
    for (let s = 5; s >= 1; s--) {
      pct[s] = Math.round((counts[s] / list.length) * 100);
    }
    return pct;
  }

  private handleSubmitReview() {
    const cleanComment = this.draftComment.trim();
    if (cleanComment.length < 10) {
      this.formFeedbackError = true;
      this.formFeedback = 'Nhận xét cần tối thiểu 10 ký tự để đảm bảo chất lượng đánh giá.';
      this.render();
      return;
    }

    const product = this.getActiveProduct();
    const isVerified = this.purchasedIds.has(product.id);
    const authorName = this.ctx?.user?.name || 'Khách ShopLite';

    const newRecord: ReviewRecord = {
      id: `rev-${Date.now()}`,
      productId: product.id,
      author: authorName,
      stars: this.draftStars,
      tags: Array.from(this.draftTags),
      comment: cleanComment,
      verifiedPurchase: isVerified,
      helpfulCount: 0,
      createdAt: formatTimestamp(new Date())
    };

    this.reviews = [newRecord, ...this.reviews];
    this.saveReviews();

    // Tính lại điểm trung bình từ gốc để phát sang React Catalog
    const prodReviews = this.getProductReviews(product.id);
    const seedCount = SEED_REVIEWS.filter((r) => r.productId === product.id).length;
    const userAdded = prodReviews.slice(0, Math.max(0, prodReviews.length - seedCount));
    const initialBase = DEFAULT_PRODUCTS.find((d) => d.id === product.id) || product;
    const newCount = initialBase.reviewCount + userAdded.length;
    const addedStars = userAdded.reduce((sum, r) => sum + r.stars, 0);
    const newAvg = Number(
      ((initialBase.rating * initialBase.reviewCount + addedStars) / newCount).toFixed(1)
    );

    // Cập nhật bản sao nội bộ
    this.products = this.products.map((p) =>
      p.id === product.id ? { ...p, rating: newAvg, reviewCount: newCount } : p
    );

    this.ctx?.eventBus.emit('review:stats-updated', {
      productId: product.id,
      averageRating: newAvg,
      reviewCount: newCount,
      latestStars: this.draftStars,
      verifiedPurchase: isVerified
    });

    this.draftComment = '';
    this.formFeedbackError = false;
    this.formFeedback = `Đã đăng đánh giá ${this.draftStars}★ thành công! Điểm trung bình trên React Catalog đã cập nhật thành ${newAvg}★ (${newCount} đánh giá).`;
    this.render();
  }

  private toggleHelpful(reviewId: string) {
    this.reviews = this.reviews.map((r) => {
      if (r.id !== reviewId) return r;
      const nextUpvoted = !r.upvotedByMe;
      return {
        ...r,
        upvotedByMe: nextUpvoted,
        helpfulCount: Math.max(0, r.helpfulCount + (nextUpvoted ? 1 : -1))
      };
    });
    this.saveReviews();
    this.render();
  }

  private render() {
    const product = this.getActiveProduct();
    const stats = this.computeStats(product);
    const allForProduct = this.getProductReviews(product.id);
    const filtered = allForProduct.filter((r) => {
      if (this.filterMode === '5star') return r.stars === 5;
      if (this.filterMode === 'verified') return r.verifiedPurchase;
      return true;
    });
    const isVerifiedBuyer = this.purchasedIds.has(product.id);

    this.shadow.innerHTML = `
      <style>
        :host {
          display: block;
          font-family: var(--sl-font-sans, system-ui, sans-serif);
          color: var(--sl-text-primary, #0f172a);
        }
        * {
          box-sizing: border-box;
        }
        .rev-top-bar {
          display: flex;
          flex-wrap: wrap;
          justify-content: space-between;
          align-items: center;
          gap: 10px;
          padding-bottom: 12px;
          margin-bottom: 14px;
          border-bottom: 1px solid var(--sl-border, #e2e8f0);
        }
        .rev-prod-picker {
          display: flex;
          align-items: center;
          gap: 8px;
          flex: 1 1 260px;
        }
        .rev-prod-picker select {
          flex: 1;
          padding: 7px 10px;
          border-radius: 8px;
          border: 1px solid var(--sl-border, #cbd5e1);
          background: var(--sl-surface, #ffffff);
          color: var(--sl-text-primary, #0f172a);
          font-size: 0.82rem;
          font-weight: 600;
        }
        .rev-css-test-btn {
          padding: 6px 11px;
          border-radius: 8px;
          border: 1px dashed #7c3aed;
          background: rgba(124, 58, 237, 0.08);
          color: #6d28d9;
          font-size: 0.75rem;
          font-weight: 700;
          cursor: pointer;
        }
        .rev-layout {
          display: grid;
          grid-template-columns: minmax(240px, 1fr) minmax(280px, 1.35fr);
          gap: 16px;
        }
        @media (max-width: 760px) {
          .rev-layout {
            grid-template-columns: 1fr;
          }
        }
        .rev-score-card {
          padding: 12px;
          border-radius: 10px;
          background: var(--sl-surface-subtle, #f8fafc);
          border: 1px solid var(--sl-border, #e2e8f0);
          margin-bottom: 12px;
        }
        .rev-score-main {
          display: flex;
          align-items: baseline;
          gap: 8px;
          margin-bottom: 8px;
        }
        .rev-big-num {
          font-size: 1.75rem;
          font-weight: 800;
          color: #f59e0b;
        }
        .rev-bars {
          display: flex;
          flex-direction: column;
          gap: 4px;
        }
        .rev-bar-row {
          display: flex;
          align-items: center;
          gap: 6px;
          font-size: 0.72rem;
          color: var(--sl-text-secondary, #64748b);
        }
        .rev-bar-track {
          flex: 1;
          height: 6px;
          border-radius: 999px;
          background: var(--sl-border, #e2e8f0);
          overflow: hidden;
        }
        .rev-bar-fill {
          height: 100%;
          background: #f59e0b;
        }
        .rev-form {
          padding: 12px;
          border-radius: 10px;
          border: 1px solid var(--sl-border, #e2e8f0);
          background: var(--sl-surface, #ffffff);
        }
        .rev-form h4 {
          margin: 0 0 6px;
          font-size: 0.86rem;
        }
        .rev-buyer-status {
          display: inline-block;
          font-size: 0.71rem;
          font-weight: 700;
          padding: 3px 8px;
          border-radius: 999px;
          margin-bottom: 10px;
        }
        .rev-buyer-status.is-verified {
          background: rgba(16, 185, 129, 0.14);
          color: #059669;
        }
        .rev-buyer-status.is-guest {
          background: rgba(100, 116, 139, 0.14);
          color: var(--sl-text-secondary, #475569);
        }
        .rev-star-picker {
          display: flex;
          gap: 4px;
          margin-bottom: 8px;
        }
        .rev-star-btn {
          padding: 4px 9px;
          border-radius: 6px;
          border: 1px solid var(--sl-border, #cbd5e1);
          background: var(--sl-surface-subtle, #f8fafc);
          color: var(--sl-text-secondary, #64748b);
          font-weight: 700;
          font-size: 0.78rem;
          cursor: pointer;
        }
        .rev-star-btn.is-on {
          background: rgba(245, 158, 11, 0.16);
          border-color: #f59e0b;
          color: #b45309;
        }
        .rev-tags {
          display: flex;
          flex-wrap: wrap;
          gap: 5px;
          margin-bottom: 8px;
        }
        .rev-tag-chip {
          padding: 3px 8px;
          border-radius: 999px;
          border: 1px solid var(--sl-border, #cbd5e1);
          background: transparent;
          color: var(--sl-text-secondary, #475569);
          font-size: 0.71rem;
          cursor: pointer;
        }
        .rev-tag-chip.is-active {
          background: var(--sl-primary, #2563eb);
          border-color: var(--sl-primary, #2563eb);
          color: #ffffff;
        }
        textarea {
          width: 100%;
          min-height: 66px;
          padding: 8px;
          border-radius: 8px;
          border: 1px solid var(--sl-border, #cbd5e1);
          background: var(--sl-surface-subtle, #f8fafc);
          color: var(--sl-text-primary, #0f172a);
          font-family: inherit;
          font-size: 0.8rem;
          margin-bottom: 8px;
          resize: vertical;
        }
        .rev-submit-btn {
          width: 100%;
          padding: 8px 12px;
          border-radius: 8px;
          border: none;
          background: var(--sl-primary, #2563eb);
          color: #ffffff;
          font-weight: 700;
          font-size: 0.8rem;
          cursor: pointer;
        }
        .rev-feedback {
          margin-top: 8px;
          padding: 7px 9px;
          border-radius: 7px;
          font-size: 0.74rem;
        }
        .rev-feedback.ok {
          background: rgba(16, 185, 129, 0.12);
          color: #047857;
        }
        .rev-feedback.err {
          background: rgba(239, 68, 68, 0.12);
          color: #dc2626;
        }
        .rev-filter-tabs {
          display: flex;
          gap: 6px;
          margin-bottom: 10px;
        }
        .rev-filter-btn {
          padding: 5px 10px;
          border-radius: 999px;
          border: 1px solid var(--sl-border, #cbd5e1);
          background: var(--sl-surface, #ffffff);
          color: var(--sl-text-secondary, #475569);
          font-size: 0.74rem;
          font-weight: 600;
          cursor: pointer;
        }
        .rev-filter-btn.is-active {
          background: var(--sl-primary, #2563eb);
          border-color: var(--sl-primary, #2563eb);
          color: #ffffff;
        }
        .rev-list {
          display: flex;
          flex-direction: column;
          gap: 9px;
          max-height: 350px;
          overflow-y: auto;
        }
        .rev-card {
          padding: 10px 12px;
          border-radius: 9px;
          border: 1px solid var(--sl-border, #e2e8f0);
          background: var(--sl-surface-subtle, #f8fafc);
        }
        .rev-card-head {
          display: flex;
          justify-content: space-between;
          align-items: center;
          gap: 6px;
          margin-bottom: 4px;
          font-size: 0.78rem;
        }
        .rev-verified-badge {
          font-size: 0.68rem;
          font-weight: 700;
          color: #059669;
          background: rgba(16, 185, 129, 0.14);
          padding: 1px 6px;
          border-radius: 999px;
          margin-left: 6px;
        }
        .rev-comment {
          margin: 5px 0 7px;
          font-size: 0.8rem;
          line-height: 1.42;
        }
        .rev-card-tags {
          display: flex;
          flex-wrap: wrap;
          gap: 4px;
          margin-bottom: 6px;
        }
        .rev-card-tags span {
          font-size: 0.68rem;
          padding: 1px 6px;
          border-radius: 4px;
          background: var(--sl-surface, #ffffff);
          border: 1px solid var(--sl-border, #e2e8f0);
        }
        .rev-card-foot {
          display: flex;
          justify-content: space-between;
          align-items: center;
          font-size: 0.71rem;
          color: var(--sl-text-secondary, #64748b);
        }
        .rev-helpful-btn {
          padding: 3px 8px;
          border-radius: 6px;
          border: 1px solid var(--sl-border, #cbd5e1);
          background: var(--sl-surface, #ffffff);
          color: var(--sl-text-secondary, #475569);
          font-size: 0.71rem;
          cursor: pointer;
        }
        .rev-helpful-btn.is-upvoted {
          border-color: var(--sl-primary, #2563eb);
          color: var(--sl-primary, #2563eb);
          font-weight: 700;
        }
        .rev-empty {
          padding: 22px;
          text-align: center;
          border: 1px dashed var(--sl-border, #cbd5e1);
          border-radius: 9px;
          font-size: 0.8rem;
          color: var(--sl-text-secondary, #64748b);
        }
      </style>
      ${
        this.aggressiveCssTest
          ? `<style>
              /* Cố tình khai báo selector toàn cục cực mạnh bên trong Shadow DOM (Kịch bản F2) */
              button {
                background: #dc2626 !important;
                color: #ffffff !important;
                border-color: #991b1b !important;
                box-shadow: 0 0 0 2px rgba(220, 38, 38, 0.25) !important;
              }
            </style>`
          : ''
      }

      <div class="rev-top-bar">
        <div class="rev-prod-picker">
          <span>Đang xem:</span>
          <select data-action="select-product">
            ${this.products
              .map(
                (p) => `
              <option value="${p.id}" ${p.id === product.id ? 'selected' : ''}>
                ${p.icon} ${escapeHtml(p.name)} (★ ${p.rating.toFixed(1)})
              </option>
            `
              )
              .join('')}
          </select>
        </div>

        <button type="button" class="rev-css-test-btn" data-action="toggle-css-chaos">
          ${
            this.aggressiveCssTest
              ? '🛡️ Tắt CSS đỏ (Shadow DOM đang khóa kín!)'
              : '🧪 Test F2: Inject button { background: red !important }'
          }
        </button>
      </div>

      <div class="rev-layout">
        <div>
          <div class="rev-score-card">
            <div class="rev-score-main">
              <span class="rev-big-num">★ ${stats.avg.toFixed(1)}</span>
              <span>/ 5.0 (${stats.count} lượt đánh giá)</span>
            </div>
            <div class="rev-bars">
              ${[5, 4, 3, 2, 1]
                .map(
                  (star) => `
                <div class="rev-bar-row">
                  <span>${star}★</span>
                  <div class="rev-bar-track">
                    <div class="rev-bar-fill" style="width: ${stats.histogram[star] || 0}%"></div>
                  </div>
                  <span>${stats.histogram[star] || 0}%</span>
                </div>
              `
                )
                .join('')}
            </div>
          </div>

          <div class="rev-form">
            <h4>Viết đánh giá mới (Đồng bộ điểm sang React)</h4>
            <div class="rev-buyer-status ${isVerifiedBuyer ? 'is-verified' : 'is-guest'}">
              ${
                isVerifiedBuyer
                  ? '✓ Bạn đã mua sản phẩm này — Tự động gắn nhãn Đã mua hàng'
                  : 'ℹ️ Mua sản phẩm ở Vue Cart để nhận huy hiệu Đã mua hàng'
              }
            </div>

            <div class="rev-star-picker">
              ${[1, 2, 3, 4, 5]
                .map(
                  (n) => `
                <button type="button" class="rev-star-btn ${
                  this.draftStars === n ? 'is-on' : ''
                }" data-star="${n}">
                  ${n} ★
                </button>
              `
                )
                .join('')}
            </div>

            <div class="rev-tags">
              ${QUICK_TAGS.map(
                (tag) => `
                <button type="button" class="rev-tag-chip ${
                  this.draftTags.has(tag) ? 'is-active' : ''
                }" data-tag="${escapeHtml(tag)}">
                  + ${escapeHtml(tag)}
                </button>
              `
              ).join('')}
            </div>

            <textarea data-input="comment" placeholder="Chia sẻ trải nghiệm thực tế của bạn (tối thiểu 10 ký tự)...">${escapeHtml(
              this.draftComment
            )}</textarea>

            <button type="button" class="rev-submit-btn" data-action="submit-review">
              Gửi đánh giá với tên "${escapeHtml(this.ctx?.user?.name || 'Khách')}"
            </button>

            ${
              this.formFeedback
                ? `<div class="rev-feedback ${this.formFeedbackError ? 'err' : 'ok'}">${escapeHtml(
                    this.formFeedback
                  )}</div>`
                : ''
            }
          </div>
        </div>

        <div>
          <div class="rev-filter-tabs">
            <button type="button" class="rev-filter-btn ${
              this.filterMode === 'all' ? 'is-active' : ''
            }" data-filter="all">
              Tất cả (${allForProduct.length})
            </button>
            <button type="button" class="rev-filter-btn ${
              this.filterMode === '5star' ? 'is-active' : ''
            }" data-filter="5star">
              5 Sao
            </button>
            <button type="button" class="rev-filter-btn ${
              this.filterMode === 'verified' ? 'is-active' : ''
            }" data-filter="verified">
              Đã mua hàng
            </button>
          </div>

          ${
            filtered.length === 0
              ? `<div class="rev-empty">Chưa có nhận xét chi tiết ở bộ lọc này. Hãy là người đầu tiên viết đánh giá bên trái!</div>`
              : `<div class="rev-list">
                  ${filtered
                    .map(
                      (r) => `
                    <article class="rev-card">
                      <div class="rev-card-head">
                        <div>
                          <strong>${escapeHtml(r.author)}</strong>
                          ${
                            r.verifiedPurchase
                              ? `<span class="rev-verified-badge">✓ Đã mua hàng</span>`
                              : ''
                          }
                        </div>
                        <span style="color:#f59e0b;font-weight:700;">${'★'.repeat(r.stars)}${'☆'.repeat(
                          5 - r.stars
                        )}</span>
                      </div>
                      ${
                        r.tags.length > 0
                          ? `<div class="rev-card-tags">${r.tags
                              .map((t) => `<span>${escapeHtml(t)}</span>`)
                              .join('')}</div>`
                          : ''
                      }
                      <p class="rev-comment">${escapeHtml(r.comment)}</p>
                      <div class="rev-card-foot">
                        <span>${escapeHtml(r.createdAt)}</span>
                        <button type="button" class="rev-helpful-btn ${
                          r.upvotedByMe ? 'is-upvoted' : ''
                        }" data-helpful="${r.id}">
                          👍 Hữu ích (${r.helpfulCount})
                        </button>
                      </div>
                    </article>
                  `
                    )
                    .join('')}
                </div>`
          }
        </div>
      </div>
    `;

    this.bindEvents();
  }

  private bindEvents() {
    const prodSelect = this.shadow.querySelector<HTMLSelectElement>('[data-action="select-product"]');
    prodSelect?.addEventListener('change', (e) => {
      this.activeProductId = (e.target as HTMLSelectElement).value;
      this.formFeedback = '';
      this.render();
    });

    const cssBtn = this.shadow.querySelector('[data-action="toggle-css-chaos"]');
    cssBtn?.addEventListener('click', () => {
      this.aggressiveCssTest = !this.aggressiveCssTest;
      this.render();
    });

    this.shadow.querySelectorAll<HTMLButtonElement>('[data-star]').forEach((btn) => {
      btn.addEventListener('click', () => {
        this.draftStars = Number(btn.dataset.star || 5);
        this.render();
      });
    });

    this.shadow.querySelectorAll<HTMLButtonElement>('[data-tag]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const tag = btn.dataset.tag || '';
        if (this.draftTags.has(tag)) this.draftTags.delete(tag);
        else this.draftTags.add(tag);
        this.render();
      });
    });

    const commentBox = this.shadow.querySelector<HTMLTextAreaElement>('[data-input="comment"]');
    commentBox?.addEventListener('input', (e) => {
      this.draftComment = (e.target as HTMLTextAreaElement).value;
    });

    const submitBtn = this.shadow.querySelector('[data-action="submit-review"]');
    submitBtn?.addEventListener('click', () => this.handleSubmitReview());

    this.shadow.querySelectorAll<HTMLButtonElement>('[data-filter]').forEach((btn) => {
      btn.addEventListener('click', () => {
        this.filterMode = (btn.dataset.filter as any) || 'all';
        this.render();
      });
    });

    this.shadow.querySelectorAll<HTMLButtonElement>('[data-helpful]').forEach((btn) => {
      btn.addEventListener('click', () => {
        if (btn.dataset.helpful) this.toggleHelpful(btn.dataset.helpful);
      });
    });
  }
}

export function ensureReviewHubDefined() {
  if (!customElements.get('sl-review-hub')) {
    customElements.define('sl-review-hub', ShopLiteReviewHub);
  }
}
