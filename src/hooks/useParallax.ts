import { useEffect, useRef, useCallback, RefObject } from 'react';

interface GradientConfig {
  base: number[];
  multipliers: number[];
  stops: string[];
}

interface UseParallaxOptions {
  speed?: number;
  maxOffset?: number;
  imageScale?: number;
  gradient?: GradientConfig;
}

interface UseParallaxReturn {
  ref: RefObject<HTMLElement>;
  imageRef: RefObject<HTMLElement>;
  overlayRef: RefObject<HTMLElement>;
}

export function useParallax(options?: UseParallaxOptions): UseParallaxReturn {
  const ref = useRef<HTMLElement | null>(null);
  const imageRef = useRef<HTMLElement | null>(null);
  const overlayRef = useRef<HTMLElement | null>(null);
  const rafId = useRef<number>(0);
  const configRef = useRef(options);
  configRef.current = options;

  const update = useCallback(() => {
    const el = ref.current;
    if (!el) return;
    const cfg = configRef.current;
    const spd = cfg?.speed ?? 0.5;
    const max = cfg?.maxOffset ?? 200;
    const scale = cfg?.imageScale ?? 1;

    const scrollY = window.scrollY;
    const calculatedOffset = Math.min(scrollY * spd, max);

    const viewportHeight = window.innerHeight;
    const fadeStart = viewportHeight * 0.2;
    const fadeEnd = viewportHeight * 0.8;
    const newOpacity = scrollY < fadeStart
      ? 1
      : scrollY > fadeEnd
        ? 0.3
        : 1 - ((scrollY - fadeStart) / (fadeEnd - fadeStart)) * 0.7;

    const maxGradientShift = 20;
    const gradientProgress = Math.min(scrollY / (viewportHeight * 0.5), 1);
    const gradientShift = gradientProgress * maxGradientShift;

    const img = imageRef.current;
    if (img) {
      img.style.transform = `translateY(${calculatedOffset}px) scale(${scale})`;
      img.style.opacity = String(newOpacity);
    }

    const overlay = overlayRef.current;
    const grad = cfg?.gradient;
    if (overlay && grad) {
      const stops = grad.base.map((base, i) => {
        const alpha = base + gradientShift * grad.multipliers[i];
        return `rgba(0,0,0,${alpha.toFixed(4)}) ${grad.stops[i]}`;
      });
      overlay.style.background = `linear-gradient(to top, ${stops.join(', ')})`;
    }
  }, []);

  useEffect(() => {
    const handleScroll = () => {
      if (rafId.current) return;
      rafId.current = requestAnimationFrame(() => {
        update();
        rafId.current = 0;
      });
    };

    window.addEventListener('scroll', handleScroll, { passive: true });
    update();
    return () => {
      window.removeEventListener('scroll', handleScroll);
      if (rafId.current) cancelAnimationFrame(rafId.current);
    };
  }, [update]);

  return {
    ref: ref as React.RefObject<HTMLElement>,
    imageRef: imageRef as React.RefObject<HTMLElement>,
    overlayRef: overlayRef as React.RefObject<HTMLElement>,
  };
}
