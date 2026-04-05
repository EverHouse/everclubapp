import { useState, useRef, useCallback, type ReactNode } from 'react';
import { motion, useMotionValue, useTransform, useReducedMotion, AnimatePresence, animate } from 'framer-motion';
import { haptic } from '../utils/haptics';
import { springPresets } from '../utils/motion';
import Icon from './icons/Icon';

const isTouchDevice = typeof window !== 'undefined' && ('ontouchstart' in window || navigator.maxTouchPoints > 0);

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
  const prefersReducedMotion = useReducedMotion();
  const x = useMotionValue(0);
  const scale = useTransform(x, (val) => val !== 0 ? 1.02 : 1);
  const [swipeDirection, setSwipeDirection] = useState<'left' | 'right' | null>(null);
  const [crossedTriggerThreshold, setCrossedTriggerThreshold] = useState<'left' | 'right' | null>(null);
  const [isOpen, setIsOpen] = useState(false);
  const hasTriggeredHapticRef = useRef(false);
  const crossedRef = useRef<'left' | 'right' | null>(null);
  const swipeStartedRef = useRef(false);

  const actionWidth = threshold;
  const maxLeftSwipe = leftActions.length > 0 ? actionWidth * leftActions.length : 0;
  const maxRightSwipe = rightActions.length > 0 ? actionWidth * rightActions.length : 0;
  const triggerThreshold = actionWidth * 1.5;

  const canDrag = isTouchDevice && !disabled;

  const handleDragStart = useCallback(() => {
    if (disabled) return;
    hasTriggeredHapticRef.current = false;
    crossedRef.current = null;
    setCrossedTriggerThreshold(null);
    if (!swipeStartedRef.current) {
      swipeStartedRef.current = true;
      onSwipeStart?.();
      haptic.selection();
    }
  }, [disabled, onSwipeStart]);

  const handleDrag = useCallback((_: unknown, info: { offset: { x: number } }) => {
    if (disabled) return;
    const deltaX = info.offset.x;

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

    const newDir = deltaX > 5 ? 'right' : deltaX < -5 ? 'left' : null;
    setSwipeDirection(newDir);
  }, [disabled, leftActions.length, rightActions.length, triggerThreshold]);

  const handleDragEnd = useCallback((_: unknown, info: { offset: { x: number } }) => {
    if (disabled) return;
    swipeStartedRef.current = false;
    const deltaX = info.offset.x;
    const currentCrossed = crossedRef.current;

    const springTo = (target: number) => animate(x, target, springPresets.snappy);

    if (currentCrossed === 'right' && leftActions.length > 0) {
      springTo(0);
      setSwipeDirection(null);
      setCrossedTriggerThreshold(null);
      setIsOpen(false);
      haptic.medium();
      leftActions[0].onClick();
    } else if (currentCrossed === 'left' && rightActions.length > 0) {
      springTo(0);
      setSwipeDirection(null);
      setCrossedTriggerThreshold(null);
      setIsOpen(false);
      haptic.medium();
      rightActions[0].onClick();
    } else if (deltaX > threshold && leftActions.length > 0) {
      springTo(maxLeftSwipe);
      setSwipeDirection('right');
      setIsOpen(true);
      haptic.light();
    } else if (deltaX < -threshold && rightActions.length > 0) {
      springTo(-maxRightSwipe);
      setSwipeDirection('left');
      setIsOpen(true);
      haptic.light();
    } else {
      springTo(0);
      setSwipeDirection(null);
      setIsOpen(false);
    }

    onSwipeEnd?.();
  }, [disabled, threshold, leftActions, rightActions, maxLeftSwipe, maxRightSwipe, onSwipeEnd, x]);

  const handleActionClick = (action: SwipeAction) => {
    haptic.medium();
    action.onClick();
    x.set(0);
    setSwipeDirection(null);
    setIsOpen(false);
  };

  const close = useCallback(() => {
    animate(x, 0, springPresets.snappy);
    setSwipeDirection(null);
    setIsOpen(false);
  }, [x]);

  const showLeftActions = swipeDirection === 'right' && leftActions.length > 0;
  const showRightActions = swipeDirection === 'left' && rightActions.length > 0;

  const dragElastic = {
    left: rightActions.length > 0 ? 0.2 : 0.1,
    right: leftActions.length > 0 ? 0.2 : 0.1,
  };

  const dragConstraints = {
    left: rightActions.length > 0 ? -(maxRightSwipe + triggerThreshold) : -20,
    right: leftActions.length > 0 ? maxLeftSwipe + triggerThreshold : 20,
  };

  const springTransition = prefersReducedMotion ? { duration: 0 } : springPresets.snappy;

  return (
    <AnimatePresence>
      {!isRemoving && (
        <motion.div
          className="relative"
          exit={{ height: 0, opacity: 0, marginBottom: 0 }}
          transition={springTransition}
        >
          {leftActions.length > 0 && (
            <div 
              className={`absolute inset-0 flex items-stretch rounded-xl overflow-hidden transition-opacity duration-75 ${showLeftActions ? 'opacity-100' : 'opacity-0 pointer-events-none'}`}
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
                      className={`flex flex-col items-center justify-center gap-1 min-h-[44px] ${colorClasses[action.color]} tap-target transition-transform duration-150 pointer-events-auto tactile-btn ${isExpanded ? 'scale-105' : ''}`}
                      style={{ 
                        width: isExpanded ? actionWidth * 1.2 : actionWidth,
                        minWidth: actionWidth 
                      }}
                      aria-label={action.label}
                    >
                      <Icon name={action.icon} className={`transition-transform duration-150 ${isExpanded ? 'text-2xl scale-125' : 'text-xl'}`} />
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
              className={`absolute inset-0 flex items-stretch justify-end rounded-xl overflow-hidden transition-opacity duration-75 ${showRightActions ? 'opacity-100' : 'opacity-0 pointer-events-none'}`}
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
                      className={`flex flex-col items-center justify-center gap-1 min-h-[44px] ${colorClasses[action.color]} tap-target transition-transform duration-150 pointer-events-auto tactile-btn ${isExpanded ? 'scale-105' : ''}`}
                      style={{ 
                        width: isExpanded ? actionWidth * 1.2 : actionWidth,
                        minWidth: actionWidth 
                      }}
                      aria-label={action.label}
                    >
                      <Icon name={action.icon} className={`transition-transform duration-150 ${isExpanded ? 'text-2xl scale-125' : 'text-xl'}`} />
                      <span className="text-xs font-medium">{action.label}</span>
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          <motion.div
            drag={canDrag ? 'x' : false}
            dragDirectionLock
            dragElastic={dragElastic}
            dragConstraints={dragConstraints}
            dragMomentum={false}
            onDragStart={handleDragStart}
            onDrag={handleDrag}
            onDragEnd={handleDragEnd}
            style={{ x, scale, zIndex: 2, position: 'relative' }}
            transition={springTransition}
            onClick={isOpen ? close : undefined}
          >
            {children}
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

export default SwipeableListItem;
