import React, { useRef, useEffect, useState, useCallback } from 'react';
import { haptic } from '../../utils/haptics';

interface SegmentedButtonOption<T extends string> {
  value: T;
  label: string;
  icon?: string;
}

interface SegmentedButtonProps<T extends string> {
  options: SegmentedButtonOption<T>[];
  value: T;
  onChange: (value: T) => void;
  size?: 'sm' | 'md';
  showCheckmark?: boolean;
  'aria-label'?: string;
  className?: string;
}

function SegmentedButtonInner<T extends string>({
  options,
  value,
  onChange,
  size = 'md',
  showCheckmark = true,
  'aria-label': ariaLabel,
  className = '',
}: SegmentedButtonProps<T>) {
  const sizeStyles = size === 'sm' ? 'min-h-[40px] text-sm px-3' : 'min-h-[48px] text-base px-4';
  const containerRef = useRef<HTMLDivElement>(null);
  const buttonRefs = useRef<Map<string, HTMLButtonElement>>(new Map());
  const [indicator, setIndicator] = useState<{ left: number; width: number } | null>(null);

  const updateIndicator = useCallback(() => {
    const container = containerRef.current;
    const btn = buttonRefs.current.get(value);
    if (container && btn) {
      const containerRect = container.getBoundingClientRect();
      const btnRect = btn.getBoundingClientRect();
      setIndicator({
        left: btnRect.left - containerRect.left,
        width: btnRect.width,
      });
    }
  }, [value]);

  useEffect(() => {
    updateIndicator();
  }, [updateIndicator, options]);

  useEffect(() => {
    const observer = new ResizeObserver(() => updateIndicator());
    if (containerRef.current) observer.observe(containerRef.current);
    return () => observer.disconnect();
  }, [updateIndicator]);

  const handleSelect = (optionValue: T) => {
    if (optionValue !== value) {
      haptic.selection();
      onChange(optionValue);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    const currentIndex = options.findIndex((o) => o.value === value);
    let nextIndex = -1;

    if (e.key === 'ArrowRight' || e.key === 'ArrowDown') {
      e.preventDefault();
      nextIndex = (currentIndex + 1) % options.length;
    } else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') {
      e.preventDefault();
      nextIndex = (currentIndex - 1 + options.length) % options.length;
    }

    if (nextIndex >= 0) {
      handleSelect(options[nextIndex].value);
      const container = e.currentTarget;
      const buttons = container.querySelectorAll<HTMLButtonElement>('[role="radio"]');
      buttons[nextIndex]?.focus();
    }
  };

  const setButtonRef = (el: HTMLButtonElement | null, optionValue: string) => {
    if (el) {
      buttonRefs.current.set(optionValue, el);
    } else {
      buttonRefs.current.delete(optionValue);
    }
  };

  return (
    <div
      ref={containerRef}
      role="radiogroup"
      aria-label={ariaLabel}
      onKeyDown={handleKeyDown}
      className={`relative inline-flex rounded-xl border border-primary/20 dark:border-white/20 overflow-hidden ${className}`}
    >
      {indicator && (
        <div
          className="absolute top-0 bottom-0 rounded-xl bg-primary/10 dark:bg-white/15 pointer-events-none"
          style={{
            left: indicator.left,
            width: indicator.width,
            transition: 'left 250ms var(--m3-standard), width 250ms var(--m3-standard)',
          }}
        />
      )}
      {options.map((option, index) => {
        const isSelected = option.value === value;
        const isAfterSelected = index > 0 && options[index - 1].value === value;
        const showDivider = index > 0 && !isSelected && !isAfterSelected;

        return (
          <React.Fragment key={option.value}>
            {showDivider && (
              <div className="w-px self-stretch my-2 bg-primary/20 dark:bg-white/20" />
            )}
            {index > 0 && !showDivider && (
              <div className="w-px self-stretch my-2 bg-transparent" />
            )}
            <button
              type="button"
              role="radio"
              aria-checked={isSelected}
              tabIndex={isSelected ? 0 : -1}
              ref={(el) => setButtonRef(el, option.value)}
              onClick={() => handleSelect(option.value)}
              style={{ touchAction: 'manipulation' }}
              className={`tactile-btn relative flex items-center justify-center gap-1.5 font-medium transition-all duration-fast focus:ring-2 focus:ring-inset focus:ring-accent focus:outline-none active:bg-primary/10 dark:active:bg-white/10 ${sizeStyles} ${
                isSelected
                  ? 'text-primary dark:text-white'
                  : 'bg-transparent text-primary/70 dark:text-white/70 hover:bg-primary/5 dark:hover:bg-white/5'
              } ${index === 0 ? 'rounded-l-[11px]' : ''} ${index === options.length - 1 ? 'rounded-r-[11px]' : ''}`}
            >
              {isSelected && showCheckmark && (
                <span
                  className="shrink-0 inline-flex"
                  style={{
                    animation: 'segmentCheckIn 150ms var(--m3-standard-decel) both',
                  }}
                >
                  <svg
                    width="18"
                    height="18"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2.5"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  >
                    <polyline points="20 6 9 17 4 12" />
                  </svg>
                </span>
              )}
              {option.icon && (
                <span className="shrink-0 text-[1.1em]">{option.icon}</span>
              )}
              <span>{option.label}</span>
            </button>
          </React.Fragment>
        );
      })}
    </div>
  );
}

export const SegmentedButton = SegmentedButtonInner;

export default SegmentedButton;
