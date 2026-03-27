import { useState, useRef, useCallback, type ReactNode } from 'react';
import { haptic } from '../utils/haptics';
import Icon from './icons/Icon';

interface SwipeAction {
  id: string;
  icon: string;
  label: string;
  color: 'red' | 'green' | 'blue' | 'orange' | 'gray' | 'primary' | 'lavender';
  onClick: () => void;
}

interface SwipeableListItemProps {
  children: ReactNode;
  leftActions?: SwipeAction[];
  rightActions?: SwipeAction[];
  onSwipeStart?: () => void;
  onSwipeEnd?: () => void;
  disabled?: boolean;
  threshold?: number;
  isRemoving?: boolean;
}

const colorClasses = {
  red: 'bg-red-500 text-white',
  green: 'bg-green-500 text-white',
  blue: 'bg-blue-500 text-white',
  orange: 'bg-orange-500 text-white',
  gray: 'bg-gray-500 text-white',
  primary: 'bg-[#293515] text-white',
  lavender: 'bg-[#CCB8E4] text-[#293515]'
};

export function SwipeableListItem({
  children,
  leftActions = [],
  rightActions = [],
  onSwipeStart,
  onSwipeEnd,
  disabled = false,
  threshold = 80,
  isRemoving = false
}: SwipeableListItemProps) {
  const [translateX, setTranslateX] = useState(0);
  const [isTransitioning, setIsTransitioning] = useState(false);
  const [crossedTriggerThreshold, setCrossedTriggerThreshold] = useState<'left' | 'right' | null>(null);
  const [swipeDirection, setSwipeDirection] = useState<'left' | 'right' | null>(null);
  const startXRef = useRef(0);
  const startYRef = useRef(0);
  const isSwipingRef = useRef(false);
  const directionLockedRef = useRef<'horizontal' | 'vertical' | null>(null);
  const hasTriggeredHapticRef = useRef(false);
  const cardRef = useRef<HTMLDivElement>(null);
  const shadowRef = useRef<HTMLDivElement>(null);
  const overlayRef = useRef<HTMLDivElement>(null);
  const liveTranslateRef = useRef(0);
  const crossedRef = useRef<'left' | 'right' | null>(null);
  const directionRef = useRef<'left' | 'right' | null>(null);

  const actionWidth = threshold;
  const maxLeftSwipe = leftActions.length > 0 ? actionWidth * leftActions.length : 0;
  const maxRightSwipe = rightActions.length > 0 ? actionWidth * rightActions.length : 0;
  const triggerThreshold = actionWidth * 1.5;

  const handleTouchStart = useCallback((e: React.TouchEvent) => {
    if (disabled) return;
    const touch = e.touches[0];
    startXRef.current = touch.clientX;
    startYRef.current = touch.clientY;
    isSwipingRef.current = false;
    directionLockedRef.current = null;
    hasTriggeredHapticRef.current = false;
    crossedRef.current = null;
    directionRef.current = null;
    setCrossedTriggerThreshold(null);
    setIsTransitioning(false);
  }, [disabled]);

  const handleTouchMove = useCallback((e: React.TouchEvent) => {
    if (disabled) return;
    const touch = e.touches[0];
    const deltaX = touch.clientX - startXRef.current;
    const deltaY = touch.clientY - startYRef.current;

    if (directionLockedRef.current === null) {
      if (Math.abs(deltaX) > 10 || Math.abs(deltaY) > 10) {
        directionLockedRef.current = Math.abs(deltaX) > Math.abs(deltaY) ? 'horizontal' : 'vertical';
        if (directionLockedRef.current === 'horizontal') {
          isSwipingRef.current = true;
          onSwipeStart?.();
          haptic.selection();
        }
      }
    }

    if (directionLockedRef.current === 'horizontal') {
      let newTranslateX = deltaX;
      
      if (deltaX > 0 && leftActions.length === 0) {
        newTranslateX = deltaX * 0.2;
      } else if (deltaX < 0 && rightActions.length === 0) {
        newTranslateX = deltaX * 0.2;
      } else if (deltaX > maxLeftSwipe) {
        newTranslateX = maxLeftSwipe + (deltaX - maxLeftSwipe) * 0.2;
      } else if (deltaX < -maxRightSwipe) {
        newTranslateX = -maxRightSwipe + (deltaX + maxRightSwipe) * 0.2;
      }

      let newCrossed: 'left' | 'right' | null = null;
      if (deltaX > triggerThreshold && leftActions.length > 0) {
        if (!hasTriggeredHapticRef.current) {
          haptic.success();
          hasTriggeredHapticRef.current = true;
        }
        newCrossed = 'right';
      } else if (deltaX < -triggerThreshold && rightActions.length > 0) {
        if (!hasTriggeredHapticRef.current) {
          haptic.success();
          hasTriggeredHapticRef.current = true;
        }
        newCrossed = 'left';
      } else {
        if (crossedRef.current !== null) {
          hasTriggeredHapticRef.current = false;
        }
      }

      if (newCrossed !== crossedRef.current) {
        crossedRef.current = newCrossed;
        setCrossedTriggerThreshold(newCrossed);
      }

      const newDir = newTranslateX > 0 ? 'right' : newTranslateX < 0 ? 'left' : null;
      if (newDir !== directionRef.current) {
        directionRef.current = newDir;
        setSwipeDirection(newDir);
      }

      liveTranslateRef.current = newTranslateX;
      const card = cardRef.current;
      if (card) {
        card.style.transform = `translateX(${newTranslateX}px) scale(${newTranslateX !== 0 ? 1.02 : 1})`;
      }
      const shadow = shadowRef.current;
      if (shadow) {
        shadow.classList.toggle('active', newTranslateX !== 0);
      }
      const overlay = overlayRef.current;
      if (overlay) {
        overlay.style.display = newTranslateX !== 0 ? 'block' : 'none';
      }
    }
  }, [disabled, leftActions.length, rightActions.length, maxLeftSwipe, maxRightSwipe, triggerThreshold, onSwipeStart]);

  const handleTouchEnd = useCallback(() => {
    if (disabled || !isSwipingRef.current) return;
    
    setIsTransitioning(true);
    const currentTranslate = liveTranslateRef.current;
    const currentCrossed = crossedRef.current;

    const shadow = shadowRef.current;
    if (shadow) shadow.classList.remove('active');
    const overlay = overlayRef.current;
    if (overlay) overlay.style.display = 'none';
    
    if (currentCrossed === 'right' && leftActions.length > 0) {
      setTranslateX(0);
      setSwipeDirection(null);
      setCrossedTriggerThreshold(null);
      haptic.medium();
      leftActions[0].onClick();
    } else if (currentCrossed === 'left' && rightActions.length > 0) {
      setTranslateX(0);
      setSwipeDirection(null);
      setCrossedTriggerThreshold(null);
      haptic.medium();
      rightActions[0].onClick();
    } else if (currentTranslate > threshold && leftActions.length > 0) {
      setTranslateX(maxLeftSwipe);
      setSwipeDirection('right');
      haptic.light();
    } else if (currentTranslate < -threshold && rightActions.length > 0) {
      setTranslateX(-maxRightSwipe);
      setSwipeDirection('left');
      haptic.light();
    } else {
      setTranslateX(0);
      setSwipeDirection(null);
    }

    liveTranslateRef.current = 0;
    directionRef.current = null;
    onSwipeEnd?.();
    isSwipingRef.current = false;
  }, [disabled, threshold, leftActions, rightActions, maxLeftSwipe, maxRightSwipe, onSwipeEnd]);

  const handleActionClick = (action: SwipeAction) => {
    haptic.medium();
    action.onClick();
    setIsTransitioning(true);
    setTranslateX(0);
    setSwipeDirection(null);
  };

  const close = useCallback(() => {
    setIsTransitioning(true);
    setTranslateX(0);
    setSwipeDirection(null);
  }, []);

  const showLeftActions = swipeDirection === 'right' && leftActions.length > 0;
  const showRightActions = swipeDirection === 'left' && rightActions.length > 0;
  const isOpen = translateX !== 0;

  return (
    <div className={`relative ${isRemoving ? 'animate-card-remove' : ''}`}>
      {leftActions.length > 0 && (
        <div 
          className={`absolute inset-0 flex items-stretch rounded-xl overflow-hidden transition-opacity duration-instant ${showLeftActions ? 'opacity-100' : 'opacity-0 pointer-events-none'}`}
          style={{ zIndex: 1 }}
        >
          <div className="flex">
            {leftActions.map((action, index) => {
              const isFirstAction = index === 0;
              const isExpanded = isFirstAction && crossedTriggerThreshold === 'right';
              return (
                <button
                  key={action.id}
                  onClick={() => handleActionClick(action)}
                  className={`flex flex-col items-center justify-center gap-1 min-h-[44px] ${colorClasses[action.color]} tap-target transition-transform duration-fast pointer-events-auto tactile-btn ${isExpanded ? 'scale-105' : ''}`}
                  style={{ 
                    width: isExpanded ? actionWidth * 1.2 : actionWidth,
                    minWidth: actionWidth 
                  }}
                  aria-label={action.label}
                >
                  <Icon name={action.icon} className={`transition-transform duration-fast ${isExpanded ? 'text-2xl scale-125' : 'text-xl'}`} />
                  <span className="text-xs font-medium">{action.label}</span>
                </button>
              );
            })}
          </div>
          <div className={`flex-1 ${leftActions.length > 0 ? colorClasses[leftActions[leftActions.length - 1].color].split(' ')[0] : ''}`} />
        </div>
      )}

      {rightActions.length > 0 && (
        <div 
          className={`absolute inset-0 flex items-stretch justify-end rounded-xl overflow-hidden transition-opacity duration-instant ${showRightActions ? 'opacity-100' : 'opacity-0 pointer-events-none'}`}
          style={{ zIndex: 1 }}
        >
          <div className={`flex-1 ${rightActions.length > 0 ? colorClasses[rightActions[0].color].split(' ')[0] : ''}`} />
          <div className="flex">
            {rightActions.map((action, index) => {
              const isFirstAction = index === 0;
              const isExpanded = isFirstAction && crossedTriggerThreshold === 'left';
              return (
                <button
                  key={action.id}
                  onClick={() => handleActionClick(action)}
                  className={`flex flex-col items-center justify-center gap-1 min-h-[44px] ${colorClasses[action.color]} tap-target transition-transform duration-fast pointer-events-auto tactile-btn ${isExpanded ? 'scale-105' : ''}`}
                  style={{ 
                    width: isExpanded ? actionWidth * 1.2 : actionWidth,
                    minWidth: actionWidth 
                  }}
                  aria-label={action.label}
                >
                  <Icon name={action.icon} className={`transition-transform duration-fast ${isExpanded ? 'text-2xl scale-125' : 'text-xl'}`} />
                  <span className="text-xs font-medium">{action.label}</span>
                </button>
              );
            })}
          </div>
        </div>
      )}

      <div
        ref={cardRef}
        className={`relative ${isTransitioning ? 'transition-transform duration-fast ease-out' : ''}`}
        style={{
          transform: `translateX(${isSwipingRef.current ? liveTranslateRef.current : translateX}px)${isSwipingRef.current && liveTranslateRef.current !== 0 ? ' scale(1.02)' : ''}`,
          zIndex: 2,
        }}
        onTouchStart={handleTouchStart}
        onTouchMove={handleTouchMove}
        onTouchEnd={handleTouchEnd}
        onClick={isOpen ? close : undefined}
      >
        <div ref={shadowRef} className="swipe-shadow-layer" />
        <div ref={overlayRef} className="absolute inset-0 rounded-xl bg-black/5 dark:bg-white/[0.08] pointer-events-none" style={{ zIndex: 3, display: 'none' }} />
        {children}
      </div>
    </div>
  );
}

export default SwipeableListItem;
