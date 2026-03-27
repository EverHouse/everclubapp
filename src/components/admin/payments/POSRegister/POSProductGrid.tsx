import React from 'react';
import type { CafeItem, MerchItem } from '../../../../types/data';
import Icon from '../../../icons/Icon';
import {
  type CategoryTab,
  CAFE_CATEGORY_ICONS,
  cafeItemToCartProduct,
  merchItemToCartProduct,
} from './posTypes';

interface POSProductGridProps {
  activeTab: CategoryTab;
  isMobile: boolean;
  passProducts: { productId: string; name: string; priceCents: number; icon: string }[];
  passProductsLoading: boolean;
  passProductsError?: string | null;
  feeProducts?: { productId: string; name: string; priceCents: number; icon: string }[];
  feeProductsLoading?: boolean;
  cafeLoading: boolean;
  sortedCafeCategories: string[];
  groupedCafeItems: Record<string, CafeItem[]>;
  merchItems?: MerchItem[];
  merchLoading?: boolean;
  addedProductId: string | null;
  addToCart: (product: { productId: string; name: string; priceCents: number; icon: string }) => void;
}

const ProductCard: React.FC<{
  product: { productId: string; name: string; priceCents: number; icon: string };
  isAdded: boolean;
  onClick: () => void;
}> = ({ product, isAdded, onClick }) => (
  <button
    key={product.productId}
    onClick={onClick}
    className={`tactile-card flex flex-col items-center gap-2 p-3 rounded-xl bg-white/60 dark:bg-white/5 border border-primary/10 dark:border-white/10 hover:bg-white/80 dark:hover:bg-white/10 transition-all duration-fast text-center active:scale-95 ${
      isAdded ? 'scale-95 ring-2 ring-emerald-400/50' : ''
    }`}
  >
    <Icon name={product.icon} className="text-3xl text-primary dark:text-white" />
    <span className="text-sm font-medium text-primary dark:text-white leading-tight">{product.name}</span>
    <span className="text-lg font-bold text-primary dark:text-white">
      ${(product.priceCents / 100).toFixed(2)}
    </span>
  </button>
);

const SkeletonCards: React.FC<{ count: number }> = ({ count }) => (
  <>
    {Array.from({ length: count }).map((_, i) => (
      <div
        key={`skeleton-${i}`}
        className="flex flex-col items-center gap-2 p-3 rounded-xl bg-white/60 dark:bg-white/5 border border-primary/10 dark:border-white/10 animate-pulse"
      >
        <div className="w-8 h-8 rounded-full bg-primary/10 dark:bg-white/10" />
        <div className="w-16 h-3 rounded bg-primary/10 dark:bg-white/10" />
        <div className="w-10 h-4 rounded bg-primary/10 dark:bg-white/10" />
      </div>
    ))}
  </>
);

const POSProductGrid: React.FC<POSProductGridProps> = ({
  activeTab,
  isMobile,
  passProducts,
  passProductsLoading,
  passProductsError,
  feeProducts = [],
  feeProductsLoading = false,
  cafeLoading,
  sortedCafeCategories,
  groupedCafeItems,
  merchItems = [],
  merchLoading = false,
  addedProductId,
  addToCart,
}) => {
  const gridCols = isMobile ? 'grid-cols-2' : 'grid-cols-3 xl:grid-cols-4';

  const renderProductCard = (product: { productId: string; name: string; priceCents: number; icon: string }) => (
    <ProductCard
      key={product.productId}
      product={product}
      isAdded={addedProductId === product.productId}
      onClick={() => addToCart(product)}
    />
  );

  if (activeTab === 'products') {
    if (feeProductsLoading) {
      return (
        <div className={`grid ${gridCols} gap-2`}>
          <SkeletonCards count={4} />
        </div>
      );
    }

    if (feeProducts.length === 0) {
      return (
        <div className="flex flex-col items-center justify-center py-12 gap-3">
          <Icon name="sell" className="text-4xl text-primary/30 dark:text-white/30" />
          <p className="text-primary/60 dark:text-white/60 font-medium">No products available</p>
        </div>
      );
    }

    return (
      <div className={`grid ${gridCols} gap-2`}>
        {feeProducts.map(renderProductCard)}
      </div>
    );
  }

  if (activeTab === 'merch') {
    if (merchLoading) {
      return (
        <div className={`grid ${gridCols} gap-2`}>
          <SkeletonCards count={6} />
        </div>
      );
    }

    if (merchItems.length === 0) {
      return (
        <div className="flex flex-col items-center justify-center py-12 gap-3">
          <Icon name="storefront" className="text-4xl text-primary/30 dark:text-white/30" />
          <p className="text-primary/60 dark:text-white/60 font-medium">No merchandise available</p>
        </div>
      );
    }

    const merchByType: Record<string, MerchItem[]> = {};
    merchItems.forEach(item => {
      const t = item.type || 'Other';
      if (!merchByType[t]) merchByType[t] = [];
      merchByType[t].push(item);
    });
    const sortedTypes = Object.keys(merchByType).sort();

    return (
      <div className="space-y-3">
        {sortedTypes.map(type => (
          <div key={type}>
            <p className="text-xs font-medium text-primary/40 dark:text-white/40 mb-1.5 flex items-center gap-1">
              <Icon name="storefront" className="text-xs" />
              {type}
            </p>
            <div className={`grid ${gridCols} gap-2`}>
              {merchByType[type].map(item => {
                const hasTrackedStock = item.stockQuantity != null;
                const outOfStock = hasTrackedStock && item.stockQuantity! <= 0;
                const cartProduct = merchItemToCartProduct(item);
                return (
                  <button
                    key={cartProduct.productId}
                    onClick={() => !outOfStock && addToCart(cartProduct)}
                    disabled={outOfStock}
                    className={`tactile-card flex flex-col items-center gap-2 p-3 rounded-xl bg-white/60 dark:bg-white/5 border border-primary/10 dark:border-white/10 transition-all duration-fast text-center ${
                      outOfStock
                        ? 'opacity-50 cursor-not-allowed'
                        : `hover:bg-white/80 dark:hover:bg-white/10 active:scale-95 ${addedProductId === cartProduct.productId ? 'scale-95 ring-2 ring-emerald-400/50' : ''}`
                    }`}
                  >
                    <Icon name={cartProduct.icon} className="text-3xl text-primary dark:text-white" />
                    <span className="text-sm font-medium text-primary dark:text-white leading-tight">{cartProduct.name}</span>
                    <span className="text-lg font-bold text-primary dark:text-white">
                      ${(cartProduct.priceCents / 100).toFixed(2)}
                    </span>
                    {hasTrackedStock && (
                      <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded ${outOfStock ? 'bg-red-100 dark:bg-red-900/30 text-red-600 dark:text-red-400' : 'bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-400'}`}>
                        {outOfStock ? 'Out of stock' : `${item.stockQuantity} left`}
                      </span>
                    )}
                  </button>
                );
              })}
            </div>
          </div>
        ))}
      </div>
    );
  }

  if (activeTab === 'passes' || activeTab === 'all') {
    const showPasses = activeTab === 'all' || activeTab === 'passes';
    const showProducts = activeTab === 'all';
    const showCafe = activeTab === 'all';

    return (
      <div className="space-y-4">
        {showPasses && (
          <div>
            {activeTab === 'all' && (
              <h4 className="text-xs font-semibold text-primary/50 dark:text-white/50 uppercase tracking-wider mb-2 flex items-center gap-1.5">
                <Icon name="confirmation_number" className="text-sm" />
                Passes
              </h4>
            )}
            <div className={`grid ${gridCols} gap-2`}>
              {passProductsLoading
                ? Array.from({ length: 3 }).map((_, i) => (
                    <div key={i} className="h-20 rounded-xl bg-surface/50 dark:bg-white/5 animate-pulse" />
                  ))
                : passProductsError
                  ? <div className="col-span-full text-center py-4 text-red-500 dark:text-red-400 text-sm">Failed to load passes. Please refresh.</div>
                  : passProducts.map(renderProductCard)}
            </div>
          </div>
        )}
        {showProducts && (feeProductsLoading || feeProducts.length > 0) && (
          <div>
            <h4 className="text-xs font-semibold text-primary/50 dark:text-white/50 uppercase tracking-wider mb-2 flex items-center gap-1.5">
              <Icon name="sell" className="text-sm" />
              Products
            </h4>
            <div className={`grid ${gridCols} gap-2`}>
              {feeProductsLoading
                ? <SkeletonCards count={2} />
                : feeProducts.map(renderProductCard)}
            </div>
          </div>
        )}
        {showCafe && (
          <div>
            <h4 className="text-xs font-semibold text-primary/50 dark:text-white/50 uppercase tracking-wider mb-2 flex items-center gap-1.5">
              <Icon name="coffee" className="text-sm" />
              Cafe
            </h4>
            {cafeLoading ? (
              <div className={`grid ${gridCols} gap-2`}>
                <SkeletonCards count={6} />
              </div>
            ) : sortedCafeCategories.length > 0 ? (
              <div className="space-y-3">
                {sortedCafeCategories.map(cat => (
                  <div key={cat}>
                    <p className="text-xs font-medium text-primary/40 dark:text-white/40 mb-1.5 flex items-center gap-1">
                      <Icon name={CAFE_CATEGORY_ICONS[cat] || 'restaurant'} className="text-xs" />
                      {cat}
                    </p>
                    <div className={`grid ${gridCols} gap-2`}>
                      {groupedCafeItems[cat].map(item =>
                        renderProductCard(cafeItemToCartProduct(item))
                      )}
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-sm text-primary/40 dark:text-white/40 py-4 text-center">No cafe items available</p>
            )}
          </div>
        )}
      </div>
    );
  }

  if (activeTab === 'cafe') {
    if (cafeLoading) {
      return (
        <div className={`grid ${gridCols} gap-2`}>
          <SkeletonCards count={8} />
        </div>
      );
    }

    if (sortedCafeCategories.length === 0) {
      return (
        <div className="flex flex-col items-center justify-center py-12 gap-3">
          <Icon name="coffee" className="text-4xl text-primary/30 dark:text-white/30" />
          <p className="text-primary/60 dark:text-white/60 font-medium">No cafe items available</p>
        </div>
      );
    }

    return (
      <div className="space-y-3">
        {sortedCafeCategories.map(cat => (
          <div key={cat}>
            <p className="text-xs font-medium text-primary/40 dark:text-white/40 mb-1.5 flex items-center gap-1">
              <Icon name={CAFE_CATEGORY_ICONS[cat] || 'restaurant'} className="text-xs" />
              {cat}
            </p>
            <div className={`grid ${gridCols} gap-2`}>
              {groupedCafeItems[cat].map(item =>
                renderProductCard(cafeItemToCartProduct(item))
              )}
            </div>
          </div>
        ))}
      </div>
    );
  }

  return null;
};

export default POSProductGrid;
