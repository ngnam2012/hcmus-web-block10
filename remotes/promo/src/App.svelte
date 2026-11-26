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
      desc: 'Đơn từ 1,5 triệu và tối thiểu 2 món',
      type: 'percent',
      value: 15,
      maxDiscount: 320_000,
      minSubtotal: 1_500_000,
      minItems: 2
    },
    {
      code: 'VIP350K',
      title: 'Ưu đãi VIP Giảm 350K',
      desc: 'Đơn từ 3.000.000 ₫',
      type: 'fixed',
      value: 350_000,
      minSubtotal: 3_000_000,
      minItems: 1
    }
  ];

  const SECRET_VOUCHER = {
    code: 'SHOPLITE20',
    title: 'Mã giảm 20% (Tối đa 250K)',
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
  let feedbackType = 'info';

  function isEligible(voucher, currentSubtotal, currentQty) {
    if (currentSubtotal < voucher.minSubtotal) return false;
    if (voucher.minItems && currentQty < voucher.minItems) return false;
    return true;
  }

  function estimateBenefit(voucher, currentSubtotal, currentQty) {
    if (!isEligible(voucher, currentSubtotal, currentQty)) return 0;
    if (voucher.type === 'freeship') {
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
        ? `Đã áp dụng mã ${voucher.code} (Tiết kiệm ${formatVND(saved)}).`
        : `Đã áp dụng mã ${voucher.code} (Đơn hàng hiện đã đủ điều kiện miễn phí vận chuyển).`;

    ctx.eventBus.emit('promo:applied', { ...voucher });
  }

  function removeVoucher() {
    appliedCode = '';
    feedbackType = 'info';
    feedbackMsg = 'Đã gỡ mã khuyến mãi.';
    ctx.eventBus.emit('promo:removed', {});
  }

  function handleManualSubmit() {
    const normalized = manualInput.trim().toUpperCase();
    if (!normalized) {
      feedbackType = 'error';
      feedbackMsg = 'Vui lòng nhập mã giảm giá (ví dụ: SHOPLITE20).';
      return;
    }
    const allKnown = [...VOUCHERS, SECRET_VOUCHER];
    const found = allKnown.find((v) => v.code === normalized);
    if (!found) {
      feedbackType = 'error';
      feedbackMsg = `Mã "${normalized}" không hợp lệ. Có thể thử SHOPLITE20 hoặc TECH10.`;
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
      feedbackMsg = 'Vui lòng thêm sản phẩm vào giỏ trước khi tự động chọn mã.';
      return;
    }
    let best = null;
    let bestBenefit = 0;

    for (const v of VOUCHERS) {
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
          ? 'Đơn đã được miễn phí vận chuyển. Tăng giá trị hoặc số lượng để mở mã giảm sâu hơn.'
          : `Cần thêm ${formatVND(Math.max(0, 500_000 - subtotal))} để đủ điều kiện mã đầu tiên (FREESHIP).`;
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
        feedbackMsg = `Mã ${payload?.code || ''} đã gỡ do giỏ hàng giảm dưới hạn mức tối thiểu.`;
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
        feedbackMsg = `Đơn ${payload?.orderCode} đã thanh toán thành công.`;
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
        <span class="promo-unlocked">Đơn hàng đã đủ điều kiện miễn phí vận chuyển</span>
      {:else}
        <span>
          Mua thêm <strong>{formatVND(remainingFreeship)}</strong> để được miễn phí vận chuyển
        </span>
      {/if}
      <span class="promo-pct">{formatPercent(freeshipRatio)}</span>
    </div>

    <div class="promo-track">
      <div class="promo-fill" style={`width: ${freeshipRatio}%`}></div>
    </div>

    <div class="promo-vip-line">
      {#if remainingVip === 0 && subtotal > 0}
        <span class="promo-vip-ok">Đã đạt mốc đơn VIP (Mở khóa mã VIP350K)</span>
      {:else}
        <span>Mốc VIP 3.000.000 ₫: còn thiếu {formatVND(remainingVip)} ({formatPercent(vipRatio)})</span>
      {/if}
    </div>
  </div>

  <div class="promo-controls-row">
    <form class="promo-input-group" on:submit|preventDefault={handleManualSubmit}>
      <input
        type="text"
        bind:value={manualInput}
        placeholder="Nhập mã giảm giá (VD: SHOPLITE20)..."
        aria-label="Mã khuyến mãi"
      />
      <button type="submit" class="promo-apply-btn">Áp dụng</button>
    </form>

    <button type="button" class="promo-auto-btn" on:click={autoPickBestVoucher}>
      Tự chọn mã tối ưu
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
              <span class="promo-save-tag">Giảm {formatVND(benefit)}</span>
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
          {isSelected ? 'Đang chọn' : eligible ? 'Áp dụng' : 'Chưa đủ ĐK'}
        </button>
      </div>
    {/each}
  </div>
</div>

<style>
  .promo-root {
    font-family: var(--sl-font-sans, system-ui, sans-serif);
    color: var(--sl-text-primary, #1e293b);
  }

  .promo-milestones {
    padding: 12px 14px;
    border-radius: 6px;
    background: var(--sl-surface-subtle, #f8fafc);
    border: 1px solid var(--sl-border, #e2e8f0);
    margin-bottom: 12px;
  }

  .promo-bar-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    font-size: 0.82rem;
    margin-bottom: 6px;
  }

  .promo-unlocked {
    color: #15803d;
    font-weight: 600;
  }

  .promo-pct {
    font-weight: 600;
    font-size: 0.78rem;
    color: var(--sl-primary, #1d4ed8);
  }

  .promo-track {
    height: 7px;
    border-radius: 4px;
    background: var(--sl-border, #e2e8f0);
    overflow: hidden;
  }

  .promo-fill {
    height: 100%;
    background: var(--sl-primary, #1d4ed8);
    transition: width 0.25s ease;
  }

  .promo-vip-line {
    margin-top: 6px;
    font-size: 0.74rem;
    color: var(--sl-text-secondary, #64748b);
  }

  .promo-vip-ok {
    color: var(--sl-primary, #1d4ed8);
    font-weight: 600;
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
    border-radius: 6px;
    border: 1px solid var(--sl-border, #cbd5e1);
    background: var(--sl-surface, #ffffff);
    color: var(--sl-text-primary, #1e293b);
    font-size: 0.8rem;
    text-transform: uppercase;
  }

  .promo-apply-btn {
    padding: 7px 12px;
    border-radius: 6px;
    border: 1px solid var(--sl-border, #cbd5e1);
    background: var(--sl-surface, #ffffff);
    color: var(--sl-text-primary, #1e293b);
    font-weight: 600;
    font-size: 0.78rem;
    cursor: pointer;
  }

  .promo-auto-btn {
    padding: 7px 12px;
    border-radius: 6px;
    border: 1px solid var(--sl-primary, #1d4ed8);
    background: var(--sl-primary, #1d4ed8);
    color: #ffffff;
    font-weight: 600;
    font-size: 0.78rem;
    cursor: pointer;
  }

  .promo-feedback {
    display: flex;
    justify-content: space-between;
    align-items: center;
    gap: 8px;
    padding: 8px 10px;
    border-radius: 6px;
    font-size: 0.77rem;
    margin-bottom: 10px;
  }

  .promo-feedback.is-success {
    background: rgba(22, 163, 74, 0.08);
    border: 1px solid rgba(22, 163, 74, 0.35);
    color: #15803d;
  }

  .promo-feedback.is-error {
    background: rgba(220, 38, 38, 0.08);
    border: 1px solid rgba(220, 38, 38, 0.35);
    color: #b91c1c;
  }

  .promo-feedback.is-info {
    background: var(--sl-surface-subtle, #f1f5f9);
    border: 1px solid var(--sl-border, #cbd5e1);
    color: var(--sl-text-primary, #1e293b);
  }

  .promo-clear-link {
    background: none;
    border: none;
    color: inherit;
    font-weight: 600;
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
    border-radius: 6px;
    border: 1px solid var(--sl-border, #e2e8f0);
    background: var(--sl-surface, #ffffff);
  }

  .promo-ticket.is-eligible {
    border-color: var(--sl-border, #cbd5e1);
  }

  .promo-ticket.is-selected {
    border-color: var(--sl-primary, #1d4ed8);
    background: var(--sl-surface-subtle, #f8fafc);
  }

  .promo-ticket.is-locked {
    opacity: 0.68;
  }

  .promo-code-row {
    display: flex;
    align-items: center;
    gap: 6px;
    margin-bottom: 2px;
  }

  .promo-code-row code {
    font-weight: 700;
    font-size: 0.75rem;
    color: var(--sl-primary, #1d4ed8);
  }

  .promo-save-tag {
    font-size: 0.67rem;
    font-weight: 600;
    padding: 1px 5px;
    border-radius: 4px;
    background: rgba(22, 163, 74, 0.1);
    color: #15803d;
  }

  .promo-ticket-title {
    font-size: 0.77rem;
    font-weight: 600;
  }

  .promo-ticket-desc {
    font-size: 0.7rem;
    color: var(--sl-text-secondary, #64748b);
  }

  .promo-ticket-btn {
    padding: 5px 9px;
    border-radius: 4px;
    border: 1px solid var(--sl-border, #cbd5e1);
    background: var(--sl-surface-subtle, #f8fafc);
    color: var(--sl-text-primary, #1e293b);
    font-size: 0.72rem;
    font-weight: 600;
    cursor: pointer;
    flex-shrink: 0;
  }

  .promo-ticket.is-selected .promo-ticket-btn {
    background: var(--sl-primary, #1d4ed8);
    border-color: var(--sl-primary, #1d4ed8);
    color: #ffffff;
  }
</style>
