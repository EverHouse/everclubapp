import React, { useState, useMemo, useRef, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTheme } from '../../contexts/ThemeContext';
import { Footer } from '../../components/Footer';
import { MenuItemSkeleton, SkeletonList } from '../../components/skeletons';
import { usePageReady } from '../../stores/pageReadyStore';
import { AnimatedPage, AnimatedSection, MotionListItem, AccordionContent } from '../../components/motion';
import SmoothReveal from '../../components/motion/SmoothReveal';
import { scrollToAccordion } from '../../utils/motion';
import SEO from '../../components/SEO';
import { fetchWithCredentials } from '../../hooks/queries/useFetch';
import Icon from '../../components/icons/Icon';

interface CafeItem {
  id: string;
  name: string;
  category: string;
  price: number;
  desc?: string;
  image?: string;
  icon?: string;
}

const PublicCafe: React.FC = () => {
  const _navigate = useNavigate();
  const { effectiveTheme } = useTheme();
  const { setPageReady } = usePageReady();
  const isDark = effectiveTheme === 'dark';
  const [cafeMenu, setCafeMenu] = useState<CafeItem[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [openIds, setOpenIds] = useState<Set<string>>(new Set());
  const [lastOpenedId, setLastOpenedId] = useState<string | null>(null);
  const lastOpenedRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (lastOpenedId && lastOpenedRef.current) {
      scrollToAccordion(lastOpenedRef.current);
      setLastOpenedId(null);
    }
  }, [lastOpenedId]);

  const categories = useMemo(() => Array.from(new Set(cafeMenu.map(item => item.category))), [cafeMenu]);
  const [activeCategory, setActiveCategory] = useState('');
  const categoryScrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!isLoading) {
      setPageReady(true);
    }
  }, [isLoading, setPageReady]);

  const fetchMenu = useCallback(async () => {
    try {
      const data = await fetchWithCredentials<Record<string, unknown>[]>('/api/cafe-menu');
      const normalized = data.map((item: Record<string, unknown>) => ({
        id: String(item.id ?? ''),
        name: String(item.name ?? ''),
        category: String(item.category ?? ''),
        price: parseFloat(String(item.price)) || 0,
        desc: String(item.description ?? item.desc ?? ''),
        image: String(item.image_url ?? item.image ?? ''),
        icon: String(item.icon ?? '')
      }));
      setCafeMenu(normalized);
    } catch (error: unknown) {
      console.error('Failed to fetch cafe menu:', error);
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchMenu();
  }, [fetchMenu]);

  useEffect(() => {
    const handleAppRefresh = () => { fetchMenu(); };
    window.addEventListener('app-refresh', handleAppRefresh);
    return () => window.removeEventListener('app-refresh', handleAppRefresh);
  }, [fetchMenu]);

  useEffect(() => {
    if (categories.length > 0 && !categories.includes(activeCategory)) {
      setActiveCategory(categories[0]);
    }
  }, [categories, activeCategory]);

  useEffect(() => {
    if (categoryScrollRef.current) {
      const buttons = categoryScrollRef.current.querySelectorAll('button');
      const activeBtn = Array.from(buttons).find(btn => btn.textContent === activeCategory) as HTMLElement | undefined;
      if (activeBtn) {
        activeBtn.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'center' });
      }
    }
  }, [activeCategory]);

  const itemsByCategory = useMemo(() => {
    return categories.map(cat => ({
      category: cat,
      items: cafeMenu.filter(i => i.category === cat)
    }));
  }, [cafeMenu, categories]);

  return (
    <AnimatedPage>
    <SEO title="Café Menu | Ever Club — Tustin, OC" description="Explore the Ever Club café menu. Farm-to-table breakfast, artisan lunch, craft coffee & curated beverages at OC's premier indoor golf & social club." url="/menu" keywords="Ever Club cafe menu, golf club restaurant Tustin, cafe near Trackman simulator Orange County, indoor golf club dining OC" />
    <div 
      className="full-bleed-page flex flex-col bg-[#EAEBE6] dark:bg-[#141414] overflow-x-hidden w-full max-w-full"
    >
      <div className="full-bleed-bg" aria-hidden="true" />
      <AnimatedSection className="px-6 pt-4 md:pt-2 pb-6 bg-[#EAEBE6] dark:bg-[#141414]">
        <h1 className="text-3xl sm:text-4xl md:text-5xl text-primary dark:text-white mb-4 leading-none" style={{ fontFamily: 'var(--font-display)' }}>Cafe Menu</h1>
        <p className="text-base text-primary/70 dark:text-white/70 leading-relaxed max-w-[90%]" style={{ fontFamily: 'var(--font-body)' }}>
          Curated bites and beverages at the House. From artisan coffee to light fare.
        </p>
      </AnimatedSection>

      <AnimatedSection delay={1} viewport>
        <div
          ref={categoryScrollRef}
          className="flex gap-2 overflow-x-auto px-6 pb-4 scrollbar-hide scroll-fade-right"
        >
          {categories.map((cat) => (
            <button
              key={cat}
              onClick={() => setActiveCategory(cat)}
              className={`tactile-btn px-4 py-2 rounded-[4px] text-sm font-bold whitespace-nowrap transition-colors duration-fast flex-shrink-0 min-h-[44px] ${
                activeCategory === cat
                  ? 'bg-primary text-white'
                  : 'bg-white dark:bg-white/5 text-primary dark:text-white hover:bg-primary/10 dark:hover:bg-white/10'
              }`}
            >
              {cat}
            </button>
          ))}
        </div>
      </AnimatedSection>

      <AnimatedSection delay={2} viewport className="px-6 space-y-3 pb-8 flex-1">
        {isLoading && (
          <SkeletonList count={5} Component={MenuItemSkeleton} isDark={isDark} />
        )}
        <SmoothReveal isLoaded={!isLoading}>
        {cafeMenu.length === 0 ? (
          <div className="flex flex-col items-center py-20">
            <Icon name="restaurant_menu" className="text-5xl text-primary/30 dark:text-white/30 mb-4" />
            <p className="text-primary/60 dark:text-white/60">Menu items are being updated.</p>
            <p className="text-primary/40 dark:text-white/40 text-sm mt-2">Check back soon for our latest offerings.</p>
          </div>
        ) : (
          itemsByCategory.map(cat => (
            <div
              key={cat.category}
              className={activeCategory === cat.category ? 'block space-y-3' : 'hidden'}
            >
              {cat.items.map((item, index) => {
                const isExpanded = openIds.has(item.id);
                return (
                  <MotionListItem
                    key={item.id}
                    index={index}
                    className="accordion-item-wrapper bg-white dark:bg-[#1a1d15] rounded-xl overflow-hidden shadow-layered dark:shadow-black/20 transition-colors duration-fast"
                  >
                    <div ref={item.id === lastOpenedId ? (el) => { if (el) lastOpenedRef.current = el.closest('.accordion-item-wrapper') as HTMLDivElement; } : undefined} />
                    <div
                      onClick={() => { if (isExpanded) { setOpenIds(prev => { const next = new Set(prev); next.delete(item.id); return next; }); } else { setOpenIds(prev => new Set(prev).add(item.id)); setLastOpenedId(item.id); } }}
                      role="button"
                      tabIndex={0}
                      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); if (isExpanded) { setOpenIds(prev => { const next = new Set(prev); next.delete(item.id); return next; }); } else { setOpenIds(prev => new Set(prev).add(item.id)); setLastOpenedId(item.id); } } }}
                      className={`flex justify-between items-center group p-3 cursor-pointer transition-colors duration-fast hover:bg-primary/5 dark:hover:bg-white/5`}
                    >
                      <div className="flex gap-4 flex-1 items-center">
                        <div className="w-14 h-14 flex-shrink-0 rounded-lg flex items-center justify-center overflow-hidden relative bg-[#EAEBE6] dark:bg-white/5 text-primary/40 dark:text-white/40">
                          {item.image ? (
                            <img src={item.image} alt={item.name} loading="lazy" width={56} height={56} className="w-full h-full object-cover absolute inset-0 opacity-80" />
                          ) : (
                            <Icon name={item.icon || 'restaurant'} className="text-2xl" />
                          )}
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="flex justify-between items-center gap-2">
                            <h2 className="font-bold text-base leading-tight text-primary dark:text-white">{item.name}</h2>
                            <span className="font-bold text-sm whitespace-nowrap text-primary dark:text-white">
                              {item.price === 0 ? 'MP' : `$${item.price}`}
                            </span>
                          </div>
                        </div>
                      </div>
                      <Icon name="expand_more" className={`text-[20px] transition-transform duration-normal ml-2 text-primary/40 dark:text-white/40 ${isExpanded ? 'rotate-180' : ''}`} />
                    </div>
                    <AccordionContent isOpen={isExpanded}>
                      <div className="px-3 pb-3 pt-0">
                        <p className="text-sm leading-relaxed text-primary/60 dark:text-white/60">
                          {item.desc || "A delicious choice from our menu, prepared fresh to order."}
                        </p>
                      </div>
                    </AccordionContent>
                  </MotionListItem>
                );
              })}
            </div>
          ))
        )}
        </SmoothReveal>
      </AnimatedSection>


      <Footer />
    </div>
    </AnimatedPage>
  );
};

export default PublicCafe;
