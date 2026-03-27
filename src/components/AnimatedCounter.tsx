import React, { useEffect, useRef, useCallback } from 'react';

interface AnimatedCounterProps {
  value: number;
  duration?: number;
  prefix?: string;
  suffix?: string;
  className?: string;
  formatValue?: (value: number) => string;
}

const AnimatedCounter: React.FC<AnimatedCounterProps> = ({
  value,
  duration = 500,
  prefix = '',
  suffix = '',
  className = '',
  formatValue
}) => {
  const spanRef = useRef<HTMLSpanElement>(null);
  const previousValue = useRef(value);
  const animationFrame = useRef<number>(undefined);
  const isAnimatingRef = useRef(false);

  const formatDisplay = useCallback((v: number) => {
    const formatted = formatValue ? formatValue(v) : v.toString();
    return `${prefix}${formatted}${suffix}`;
  }, [formatValue, prefix, suffix]);

  useEffect(() => {
    if (value === previousValue.current) return;

    const startValue = previousValue.current;
    const endValue = value;
    const startTime = performance.now();
    const el = spanRef.current;

    if (!el) {
      previousValue.current = endValue;
      return;
    }

    isAnimatingRef.current = true;
    el.classList.add('animate-counter-change');

    const animate = (currentTime: number) => {
      const elapsed = currentTime - startTime;
      const progress = Math.min(elapsed / duration, 1);
      const easeOut = 1 - Math.pow(1 - progress, 3);
      const currentValue = Math.round(startValue + (endValue - startValue) * easeOut);

      el.textContent = formatDisplay(currentValue);

      if (progress < 1) {
        animationFrame.current = requestAnimationFrame(animate);
      } else {
        el.textContent = formatDisplay(endValue);
        isAnimatingRef.current = false;
        el.classList.remove('animate-counter-change');
        previousValue.current = endValue;
      }
    };

    animationFrame.current = requestAnimationFrame(animate);

    return () => {
      if (animationFrame.current) {
        cancelAnimationFrame(animationFrame.current);
      }
    };
  }, [value, duration, formatDisplay]);

  useEffect(() => {
    const el = spanRef.current;
    if (el && !isAnimatingRef.current) {
      el.textContent = formatDisplay(value);
    }
  }, [prefix, suffix, formatValue, value, formatDisplay]);

  return (
    <span ref={spanRef} className={className}>
      {formatDisplay(value)}
    </span>
  );
};

export default AnimatedCounter;
