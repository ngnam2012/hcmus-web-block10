<script>
  import { onDestroy, onMount } from 'svelte';
  import {
    BASE_SHIPPING_FEE,
    FREESHIP_THRESHOLD,
    VIP_GIFT_THRESHOLD,
    formatPercent,
    formatVND
  } from '@shoplite/format';

  export let ctx;

  const VOUCHERS = [
    {
      code: 'FREESHIP',
      title: 'Miễn phí vận chuyển 35K',
      desc: 'Đơn từ 500.000 ₫',
      type: 'freeship',
      value: BASE_SHIPPING_FEE,
      minSubtotal: 500_000,
      minItems: 1
    },
    {
      code: 'TECH10',
      title: 'Giảm 10% (Tối đa 180K)',
      desc: 'Đơn từ 800.000 ₫',
      type: 'percent',
      value: 10,
      maxDiscount: 180_000,
      minSubtotal: 800_000,
      minItems: 1
    },
    {
      code: 'COMBO15',
      title: 'Combo Giảm 15% (Tối đa 320K)',
      desc: 'Đơn ≥ 1,5 triệu & từ 2 món',
      type: 'percent',
      value: 15,
      maxDiscount: 320_000,
      minSubtotal: 1_500_000,
      minItems: 2
    },
    {
      code: 'VIP350K',
      title: 'Ưu đãi VIP Giảm thẳng 350K',
      desc: 'Đơn từ 3.000.000 ₫',
      type: 'fixed',
      value: 350_000,
      minSubtotal: 3_000_000,
      minItems: 1
    }
  ];

  // Mã ẩn chỉ nhập tay để kiểm chứng bộ giải mã coupon thủ công
  const SECRET_VOUCHER = {
    code: 'SHOPLITE20',
    title: 'Mã bí mật Giảm 20% (Tối đa 250K)',
    desc: 'Đơn từ 1.000.000 ₫',
    type: 'percent',
    value: 20,
    maxDiscount: 250_000,
    minSubtotal: 1_000_000,
    minItems: 1
  };

  let subtotal = 0;
  let totalQty = 0;
  let appliedCode = '';
  let manualInput = '';
  let feedbackMsg = '';
  let feedbackType = 'info'; // 'info' | 'success' | 'error'

  function isEligible(voucher, currentSubtotal, currentQty) {
    if (currentSubtotal < voucher.minSubtotal) return false;
    if (voucher.minItems && currentQty < voucher.minItems) return false;
    return true;
  }

  function estimateBenefit(voucher, currentSubtotal, currentQty) {
    if (!isEligible(voucher, currentSubtotal, currentQty)) return 0;
    if (voucher.type === 'freeship') {
      // Nếu đơn đã đạt ngưỡng Freeship tự động thì mã FREESHIP không tiết kiệm thêm tiền mặt
      return currentSubtotal >= FREESHIP_THRESHOLD ? 0 : BASE_SHIPPING_FEE;
    }
    if (voucher.type === 'percent') {
      const raw = Math.round((currentSubtotal * voucher.value) / 100);
      return voucher.maxDiscount ? Math.min(raw, voucher.maxDiscount) : raw;
    }
    if (voucher.type === 'fixed') {
      return Math.min(currentSubtotal, voucher.value);
    }
    return 0;
  }

  $: freeshipRatio = Math.min(100, (subtotal / FREESHIP_THRESHOLD) * 100);
  $: remainingFreeship = Math.max(0, FREESHIP_THRESHOLD - subtotal);
  $: vipRatio = Math.min(100, (subtotal / VIP_GIFT_THRESHOLD) * 100);
  $: remainingVip = Math.max(0, VIP_GIFT_THRESHOLD - subtotal);

  function applyVoucher(voucher) {
    if (!isEligible(voucher, subtotal, totalQty)) {
      feedbackType = 'error';
      const needSub = Math.max(0, voucher.minSubtotal - subtotal);
      feedbackMsg =
        needSub > 0
          ? `Chưa đủ điều kiện: cần mua thêm ${formatVND(needSub)} để dùng mã ${voucher.code}.`
          : `Mã ${voucher.code} yêu cầu tối thiểu ${voucher.minItems} sản phẩm trong giỏ.`;
      return;
    }

    appliedCode = voucher.code;
    const saved = estimateBenefit(voucher, subtotal, totalQty);
    feedbackType = 'success';
    feedbackMsg =
      saved > 0
        ? `Đã áp dụng ${voucher.code} — Tiết kiệm ước tính ${formatVND(saved)}!`
        : `Đã áp dụng ${voucher.code} (Đơn hàng hiện đã được Freeship tự động).`;

    ctx.eventBus.emit('promo:applied', { ...voucher });
  }

  function removeVoucher() {
    appliedCode = '';
    feedbackType = 'info';
    feedbackMsg = 'Đã gỡ mã khuyến mãi khỏi đơn hàng.';
    ctx.eventBus.emit('promo:removed', {});
  }

  function handleManualSubmit() {
    const normalized = manualInput.trim().toUpperCase();
    if (!normalized) {
      feedbackType = 'error';
      feedbackMsg = 'Vui lòng nhập mã giảm giá (Gợi ý mã ẩn: SHOPLITE20).';
      return;
    }
    const allKnown = [...VOUCHERS, SECRET_VOUCHER];
    const found = allKnown.find((v) => v.code === normalized);
    if (!found) {
      feedbackType = 'error';
      feedbackMsg = `Mã "${normalized}" không tồn tại hoặc đã hết hạn. Thử SHOPLITE20 hoặc TECH10!`;
      return;
    }
    applyVoucher(found);
    if (appliedCode === found.code) {
      manualInput = '';
    }
  }

  function autoPickBestVoucher() {
    if (subtotal === 0) {
      feedbackType = 'error';
      feedbackMsg = 'Hãy thêm ít nhất 1 sản phẩm vào giỏ trước khi tối ưu mã!';
      return;
    }
    const candidates = [...VOUCHERS];
    let best = null;
    let bestBenefit = 0;

    for (const v of candidates) {
      const benefit = estimateBenefit(v, subtotal, totalQty);
      if (benefit > bestBenefit) {
        bestBenefit = benefit;
        best = v;
      }
    }

    if (!best) {
      feedbackType = 'info';
      feedbackMsg =
        subtotal >= FREESHIP_THRESHOLD
          ? 'Đơn đã có Freeship! Mua thêm hoặc tăng số lượng để mở khóa TECH10 / COMBO15.'
          : `Mua thêm ${formatVND(Math.max(0, 500_000 - subtotal))} để mở khóa voucher đầu tiên (FREESHIP).`;
      return;
    }

    applyVoucher(best);
  }

  const unsubscribers = [];

  onMount(() => {
    unsubscribers.push(
      ctx.eventBus.on(
        'cart:updated',
        (payload) => {
          subtotal = Number(payload?.subtotal || 0);
          totalQty = Number(payload?.totalQty || 0);
        },
        { replay: true }
      )
    );

    unsubscribers.push(
      ctx.eventBus.on(
        'promo:applied',
        (voucher) => {
          if (voucher?.code) appliedCode = voucher.code;
        },
        { replay: true }
      )
    );

    unsubscribers.push(
      ctx.eventBus.on('promo:invalidated', (payload) => {
        appliedCode = '';
        feedbackType = 'error';
        feedbackMsg = `Mã ${payload?.code || ''} vừa tự động gỡ do giỏ hàng giảm dưới hạn mức.`;
      })
    );

    unsubscribers.push(
      ctx.eventBus.on('promo:removed', () => {
        appliedCode = '';
      })
    );

    unsubscribers.push(
      ctx.eventBus.on('order:completed', (payload) => {
        appliedCode = '';
        feedbackType = 'success';
        feedbackMsg = `Đơn ${payload?.orderCode} đã hoàn tất! Ví voucher sẵn sàng cho đơn tiếp theo.`;
      })
    );
  });

  onDestroy(() => {
    for (const u of unsubscribers) u();
  });
</script>

<div class="promo-root">
  <div class="promo-milestones">
    <div class="promo-bar-header">
      {#if remainingFreeship === 0 && subtotal > 0}
        <span class="promo-unlocked">🚚 Đã mở khóa <strong>Miễn phí vận chuyển!</strong></span>
      {:else}
        <span>
          🚚 Mua thêm <strong>{formatVND(remainingFreeship)}</strong> để được
          <strong>Freeship</strong>
        </span>
      {/if}
      <span class="promo-pct">{formatPercent(freeshipRatio)}</span>
    </div>

    <div class="promo-track">
      <div class="promo-fill" style={`width: ${freeshipRatio}%`}></div>
    </div>

    <div class="promo-vip-line">
      {#if remainingVip === 0 && subtotal > 0}
        <span class="promo-vip-ok">👑 Đạt hạng Đơn VIP (Mở khóa VIP350K &amp; Gói quà 0₫ ở Cart v2)</span>
      {:else}
        <span>👑 Mốc VIP 3tr: còn thiếu {formatVND(remainingVip)} ({formatPercent(vipRatio)})</span>
      {/if}
    </div>
  </div>

  <div class="promo-controls-row">
    <form class="promo-input-group" on:submit|preventDefault={handleManualSubmit}>
      <input
        type="text"
        bind:value={manualInput}
        placeholder="Nhập mã (VD: SHOPLITE20)..."
        aria-label="Mã khuyến mãi"
      />
      <button type="submit" class="promo-apply-btn">Áp dụng</button>
    </form>

    <button type="button" class="promo-auto-btn" on:click={autoPickBestVoucher}>
      ⚡ Tự chọn mã lời nhất
    </button>
  </div>

  {#if feedbackMsg}
    <div class={`promo-feedback is-${feedbackType}`}>
      <span>{feedbackMsg}</span>
      {#if appliedCode}
        <button type="button" class="promo-clear-link" on:click={removeVoucher}>Gỡ mã</button>
      {/if}
    </div>
  {/if}

  <div class="promo-wallet">
    {#each VOUCHERS as v (v.code)}
      {@const eligible = isEligible(v, subtotal, totalQty)}
      {@const benefit = estimateBenefit(v, subtotal, totalQty)}
      {@const isSelected = appliedCode === v.code}
      <div class={`promo-ticket ${eligible ? 'is-eligible' : 'is-locked'} ${isSelected ? 'is-selected' : ''}`}>
        <div class="promo-ticket-main">
          <div class="promo-code-row">
            <code>{v.code}</code>
            {#if eligible && benefit > 0}
              <span class="promo-save-tag">Lời {formatVND(benefit)}</span>
            {/if}
          </div>
          <div class="promo-ticket-title">{v.title}</div>
          <div class="promo-ticket-desc">{v.desc}</div>
        </div>

        <button
          type="button"
          class="promo-ticket-btn"
          on:click={() => (isSelected ? removeVoucher() : applyVoucher(v))}
        >
          {isSelected ? 'Đang dùng ✓' : eligible ? 'Dùng ngay' : 'Chưa đủ ĐK'}
        </button>
      </div>
    {/each}
  </div>
</div>

<style>
  .promo-root {
    font-family: var(--sl-font-sans, system-ui, sans-serif);
    color: var(--sl-text-primary, #0f172a);
  }

  .promo-milestones {
    padding: 12px 14px;
    border-radius: 10px;
    background: var(--sl-surface-subtle, #f8fafc);
    border: 1px solid var(--sl-border, #e2e8f0);
    margin-bottom: 12px;
  }

  .promo-bar-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    font-size: 0.82rem;
    margin-bottom: 7px;
  }

  .promo-unlocked {
    color: #059669;
  }

  .promo-pct {
    font-weight: 800;
    font-size: 0.78rem;
    color: var(--sl-primary, #2563eb);
  }

  .promo-track {
    height: 9px;
    border-radius: 999px;
    background: var(--sl-border, #e2e8f0);
    overflow: hidden;
  }

  .promo-fill {
    height: 100%;
    border-radius: 999px;
    background: linear-gradient(90deg, #2563eb, #10b981);
    transition: width 0.3s ease;
  }

  .promo-vip-line {
    margin-top: 7px;
    font-size: 0.74rem;
    color: var(--sl-text-secondary, #64748b);
  }

  .promo-vip-ok {
    color: #7c3aed;
    font-weight: 700;
  }

  .promo-controls-row {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
    margin-bottom: 10px;
  }

  .promo-input-group {
    flex: 1 1 210px;
    display: flex;
    gap: 6px;
  }

  .promo-input-group input {
    flex: 1;
    padding: 7px 10px;
    border-radius: 8px;
    border: 1px solid var(--sl-border, #cbd5e1);
    background: var(--sl-surface, #ffffff);
    color: var(--sl-text-primary, #0f172a);
    font-size: 0.8rem;
    text-transform: uppercase;
  }

  .promo-apply-btn {
    padding: 7px 12px;
    border-radius: 8px;
    border: 1px solid var(--sl-primary, #2563eb);
    background: var(--sl-surface, #ffffff);
    color: var(--sl-primary, #2563eb);
    font-weight: 700;
    font-size: 0.78rem;
    cursor: pointer;
  }

  .promo-auto-btn {
    padding: 7px 12px;
    border-radius: 8px;
    border: none;
    background: linear-gradient(135deg, #f59e0b, #ea580c);
    color: #ffffff;
    font-weight: 700;
    font-size: 0.78rem;
    cursor: pointer;
  }

  .promo-feedback {
    display: flex;
    justify-content: space-between;
    align-items: center;
    gap: 8px;
    padding: 8px 10px;
    border-radius: 8px;
    font-size: 0.77rem;
    margin-bottom: 10px;
  }

  .promo-feedback.is-success {
    background: rgba(16, 185, 129, 0.12);
    border: 1px solid rgba(16, 185, 129, 0.35);
    color: #047857;
  }

  .promo-feedback.is-error {
    background: rgba(239, 68, 68, 0.11);
    border: 1px solid rgba(239, 68, 68, 0.35);
    color: #dc2626;
  }

  .promo-feedback.is-info {
    background: rgba(37, 99, 235, 0.1);
    border: 1px solid rgba(37, 99, 235, 0.25);
    color: var(--sl-primary, #2563eb);
  }

  .promo-clear-link {
    background: none;
    border: none;
    color: inherit;
    font-weight: 700;
    text-decoration: underline;
    cursor: pointer;
    font-size: 0.75rem;
    flex-shrink: 0;
  }

  .promo-wallet {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(215px, 1fr));
    gap: 8px;
  }

  .promo-ticket {
    display: flex;
    justify-content: space-between;
    align-items: center;
    gap: 8px;
    padding: 9px 10px;
    border-radius: 9px;
    border: 1px dashed var(--sl-border, #cbd5e1);
    background: var(--sl-surface, #ffffff);
  }

  .promo-ticket.is-eligible {
    border-style: solid;
    border-color: rgba(37, 99, 235, 0.35);
  }

  .promo-ticket.is-selected {
    border-color: #10b981;
    background: rgba(16, 185, 129, 0.08);
  }

  .promo-ticket.is-locked {
    opacity: 0.72;
  }

  .promo-code-row {
    display: flex;
    align-items: center;
    gap: 6px;
    margin-bottom: 2px;
  }

  .promo-code-row code {
    font-weight: 800;
    font-size: 0.75rem;
    color: var(--sl-primary, #2563eb);
  }

  .promo-save-tag {
    font-size: 0.67rem;
    font-weight: 700;
    padding: 1px 6px;
    border-radius: 999px;
    background: rgba(16, 185, 129, 0.15);
    color: #059669;
  }

  .promo-ticket-title {
    font-size: 0.77rem;
    font-weight: 700;
  }

  .promo-ticket-desc {
    font-size: 0.7rem;
    color: var(--sl-text-secondary, #64748b);
  }

  .promo-ticket-btn {
    padding: 6px 9px;
    border-radius: 7px;
    border: 1px solid var(--sl-border, #cbd5e1);
    background: var(--sl-surface-subtle, #f8fafc);
    color: var(--sl-text-primary, #0f172a);
    font-size: 0.72rem;
    font-weight: 700;
    cursor: pointer;
    flex-shrink: 0;
  }

  .promo-ticket.is-selected .promo-ticket-btn {
    background: #10b981;
    border-color: #10b981;
    color: #ffffff;
  }
</style>
