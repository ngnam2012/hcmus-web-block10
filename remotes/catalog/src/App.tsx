import React, { useEffect, useMemo, useState, useRef } from 'react';
import type { AppContext } from '../../../shell/src/types';
import { formatVND } from '@shoplite/format';
import { INITIAL_PRODUCTS, ProductItem } from './data';
import './catalog.css';

interface AppProps { ctx: AppContext; }

const CATEGORIES = ['Tất cả', 'Âm thanh', 'Bàn phím', 'Phụ kiện', 'Màn hình & Desk', 'Trà'] as const;
const CATEGORY_KEYS = ['all', 'audio', 'keyboard', 'accessories', 'desk', 'tea'];
export default function App({ ctx }: AppProps) {
  const query = new URLSearchParams(location.search);
  const rawPage = Number(query.get('page'));
  const page = Number.isFinite(rawPage) ? Math.max(1, Math.floor(rawPage)) : 1;
  const feedbackTimer = useRef<ReturnType<typeof setTimeout>>();
  const alive = useRef(true);
  const [addError, setAddError] = useState('');
  const [adding, setAdding] = useState(false);
  useEffect(() => () => { alive.current = false; clearTimeout(feedbackTimer.current); }, []);
  const [products, setProducts] = useState<ProductItem[]>(INITIAL_PRODUCTS);
  const [warehouseStock, setWarehouseStock] = useState<Record<string, number>>(() => ctx.cart.getSnapshot().stock);
  const [reservedByProduct, setReservedByProduct] = useState<Record<string, number>>({});
  const [selectedVariants, setSelectedVariants] = useState<Record<string, string>>(() => {
    const map: Record<string, string> = {};
    for (const p of INITIAL_PRODUCTS) {
      map[p.id] = p.variants[0].id;
    }
    return map;
  });

  const [searchQuery, setSearchQuery] = useState('');
  const activeCategory = CATEGORIES[Math.max(0, CATEGORY_KEYS.indexOf(query.get('category') || 'all'))];
  const navigateFilter = (category: string, nextPage = 1) => {
    const next = new URLSearchParams(location.search);
    next.set('category', CATEGORY_KEYS[CATEGORIES.indexOf(category as typeof CATEGORIES[number])]); next.set('page', String(nextPage));
    ctx.navigate(`/products?${next}`);
  };
  const [maxPriceFilter, setMaxPriceFilter] = useState<number>(2_500_000);
  const [sortBy, setSortBy] = useState<'popular' | 'price-asc' | 'price-desc' | 'rating'>('popular');
  const [selectedProductId, setSelectedProductId] = useState<string>('p1');
  const [justAddedId, setJustAddedId] = useState<string | null>(null);

  useEffect(() => {
    ctx.eventBus.emit('catalog:ready', {
      products: products.map((p) => ({
        id: p.id,
        code: p.code,
        name: p.name,
        rating: p.rating,
        reviewCount: p.reviewCount
      }))
    });
  }, []);

  useEffect(() => {
    const unsubCart = ctx.eventBus.on(
      'cart:updated',
      (payload) => {
        const nextReserved: Record<string, number> = {};
        for (const item of payload?.items || []) {
          nextReserved[item.productId] = (nextReserved[item.productId] || 0) + Number(item.qty || 0);
        }
        setReservedByProduct(nextReserved);
      },
      { replay: true }
    );

    const unsubOrder = ctx.eventBus.on('order:completed', (payload) => {
      setWarehouseStock((prev) => {
        const updated = { ...prev };
        for (const item of payload?.items || []) {
          const current = updated[item.productId] ?? 0;
          updated[item.productId] = Math.max(0, current - Number(item.qty || 0));
        }
        return updated;
      });
      setReservedByProduct({});
    });

    const unsubReview = ctx.eventBus.on('review:stats-updated', (payload) => {
      if (!payload?.productId) return;
      setProducts((prev) =>
        prev.map((p) =>
          p.id === payload.productId
            ? { ...p, rating: payload.averageRating, reviewCount: payload.reviewCount }
            : p
        )
      );
    });

    const unsubResetStock = ctx.eventBus.on('warehouse:reset', () => {
      const fresh: Record<string, number> = {};
      for (const p of INITIAL_PRODUCTS) fresh[p.id] = p.initialStock;
      setWarehouseStock(fresh);
    });

    return () => {
      unsubCart();
      unsubOrder();
      unsubReview();
      unsubResetStock();
    };
  }, [ctx]);

  const getSelectedVariant = (product: ProductItem) => {
    const vid = selectedVariants[product.id] || product.variants[0].id;
    return product.variants.find((v) => v.id === vid) || product.variants[0];
  };

  const getEffectivePrice = (product: ProductItem) => {
    return product.basePrice + getSelectedVariant(product).priceDelta;
  };

  const filteredProducts = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    const list = products.filter((p) => {
      if (activeCategory !== 'Tất cả' && p.category !== activeCategory) return false;
      const effectivePrice = p.basePrice + (getSelectedVariant(p)?.priceDelta || 0);
      if (effectivePrice > maxPriceFilter) return false;
      if (q && !p.name.toLowerCase().includes(q) && !p.shortSpec.toLowerCase().includes(q)) {
        return false;
      }
      return true;
    });

    const sorted = [...list];
    if (sortBy === 'price-asc') {
      sorted.sort((a, b) => getEffectivePrice(a) - getEffectivePrice(b));
    } else if (sortBy === 'price-desc') {
      sorted.sort((a, b) => getEffectivePrice(b) - getEffectivePrice(a));
    } else if (sortBy === 'rating') {
      sorted.sort((a, b) => b.rating - a.rating || b.reviewCount - a.reviewCount);
    }
    return sorted;
  }, [products, searchQuery, activeCategory, maxPriceFilter, sortBy, selectedVariants]);

  const handleAddToCart = async (product: ProductItem) => {
    const totalStock = warehouseStock[product.id] ?? product.initialStock;
    const reserved = reservedByProduct[product.id] || 0;
    if (totalStock - reserved <= 0) return;

    const variant = getSelectedVariant(product);
    const unitPrice = product.basePrice + variant.priceDelta;
    const sku = `${product.id}__${variant.id}`;

    setAddError(''); setAdding(true);
    try { await ctx.cart.add({
      sku,
      productId: product.id,
      code: product.code,
      name: product.name,
      category: product.category,
      variantId: variant.id,
      variantLabel: variant.label,
      unitPrice,
      price: unitPrice,
      maxStock: totalStock
    });

    if (!alive.current) return;
    setJustAddedId(product.id);
    clearTimeout(feedbackTimer.current);
    feedbackTimer.current = setTimeout(() => {
      setJustAddedId((curr) => (curr === product.id ? null : curr));
    }, 650);
    } catch (error) { if (alive.current) setAddError(String(error)); }
    finally { if (alive.current) setAdding(false); }
  };

  const handleInspectReviews = (product: ProductItem) => {
    setSelectedProductId(product.id);
    ctx.eventBus.emit('product:select', {
      productId: product.id,
      code: product.code,
      name: product.name,
      rating: product.rating,
      reviewCount: product.reviewCount
    });
  };

  return (
    <div className="catalog-root">
      <div className="catalog-toolbar">
        <div className="catalog-search-wrap">
          <input
            type="search"
            className="catalog-search"
            placeholder="Tìm tên sản phẩm hoặc thông số..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
          />
        </div>

        <div className="catalog-controls">
          <select
            className="catalog-select"
            value={maxPriceFilter}
            onChange={(e) => setMaxPriceFilter(Number(e.target.value))}
            aria-label="Lọc trần giá"
          >
            <option value={2500000}>Tất cả mức giá</option>
            <option value={1000000}>Dưới 1.000.000 ₫</option>
            <option value={1700000}>Dưới 1.700.000 ₫</option>
          </select>

          <select
            className="catalog-select"
            value={sortBy}
            onChange={(e) => setSortBy(e.target.value as any)}
            aria-label="Sắp xếp"
          >
            <option value="popular">Sắp xếp: Mặc định</option>
            <option value="price-asc">Giá tăng dần</option>
            <option value="price-desc">Giá giảm dần</option>
            <option value="rating">Điểm đánh giá cao</option>
          </select>
        </div>
      </div>

      <div className="catalog-categories">
        {CATEGORIES.map((cat) => (
          <button
            key={cat}
            type="button"
            className={`catalog-cat-btn ${activeCategory === cat ? 'is-active' : ''}`}
            onClick={() => navigateFilter(cat)}
          >
            {cat}
          </button>
        ))}
      </div>

      <div className="catalog-summary-bar">
        <span>
          Hiển thị <strong>{filteredProducts.length}</strong> / {products.length} sản phẩm
        </span>
        <span>Tồn kho đồng bộ trực tiếp với Giỏ hàng</span>
      </div>
      {addError && <p role="alert">{addError}</p>}

      {filteredProducts.length === 0 ? (
        <div className="catalog-empty">
          Không tìm thấy sản phẩm phù hợp.{' '}
          <button
            type="button"
            className="catalog-review-link"
            onClick={() => {
              setSearchQuery('');
              navigateFilter('Tất cả');
              setMaxPriceFilter(2_500_000);
            }}
          >
            Đặt lại bộ lọc
          </button>
        </div>
      ) : (
        <div className="catalog-grid">
          {filteredProducts.slice((Math.min(page, Math.ceil(filteredProducts.length / 3)) - 1) * 3, Math.min(page, Math.ceil(filteredProducts.length / 3)) * 3).map((product) => {
            const totalStock = warehouseStock[product.id] ?? product.initialStock;
            const reserved = reservedByProduct[product.id] || 0;
            const available = Math.max(0, totalStock - reserved);
            const variant = getSelectedVariant(product);
            const unitPrice = product.basePrice + variant.priceDelta;

            return (
              <article
                key={product.id}
                className={`catalog-card ${selectedProductId === product.id ? 'is-selected' : ''}`}
              >
                <div>
                  <div className="catalog-card-top">
                    <span className="catalog-sku">{product.code}</span>
                    <div className="catalog-badges">
                      {product.badge && <span className="catalog-badge">{product.badge}</span>}
                      <span
                        className={`catalog-stock-tag ${
                          available === 0 ? 'is-out' : available <= 2 ? 'is-low' : ''
                        }`}
                      >
                        {available === 0
                          ? totalStock === 0
                            ? 'Đã hết hàng'
                            : 'Đã giữ hết trong giỏ'
                          : `Còn ${available}`}
                      </span>
                    </div>
                  </div>

                  <h3 className="catalog-title">{product.name}</h3>
                  <p className="catalog-spec">{product.shortSpec}</p>

                  <div className="catalog-rating-row">
                    <span className="catalog-stars">Điểm: {product.rating.toFixed(1)}/5</span>
                    <button
                      type="button"
                      className="catalog-review-link"
                      onClick={() => handleInspectReviews(product)}
                    >
                      {product.reviewCount} đánh giá
                    </button>
                  </div>

                  <label className="catalog-variant-label" htmlFor={`var-${product.id}`}>
                    Phiên bản:
                  </label>
                  <select
                    id={`var-${product.id}`}
                    className="catalog-variant-select"
                    value={variant.id}
                    onChange={(e) =>
                      setSelectedVariants((prev) => ({ ...prev, [product.id]: e.target.value }))
                    }
                  >
                    {product.variants.map((v) => (
                      <option key={v.id} value={v.id}>
                        {v.label} {v.priceDelta > 0 ? `(+${formatVND(v.priceDelta)})` : ''}
                      </option>
                    ))}
                  </select>
                </div>

                <div className="catalog-footer">
                  <div>
                    <span className="catalog-price">{formatVND(unitPrice)}</span>
                    {reserved > 0 && (
                      <span className="catalog-in-cart-hint">Trong giỏ: {reserved}</span>
                    )}
                  </div>

                  <button
                    type="button"
                    className="catalog-add-btn"
                    disabled={available === 0 || adding}
                    onClick={() => handleAddToCart(product)}
                  >
                    {justAddedId === product.id
                      ? 'Đã thêm'
                      : available === 0
                        ? 'Hết hàng'
                        : 'Thêm vào giỏ'}
                  </button>
                </div>
              </article>
            );
          })}
        </div>
      )}
      <nav aria-label="Trang sản phẩm" className="catalog-pages">
        {Array.from({ length: Math.ceil(filteredProducts.length / 3) }, (_, i) => <button type="button" key={i} aria-current={page === i + 1 ? 'page' : undefined} onClick={() => navigateFilter(activeCategory, i + 1)}>Trang {i + 1}</button>)}
      </nav>
    </div>
  );
}
