import React, { useCallback, useRef } from 'react';
import { motion, useReducedMotion } from 'framer-motion';
import {
  springPresets,
  tapAnimation,
  hoverAnimation,
  reducedMotionTap,
  reducedMotionHover,
} from '../../utils/motion';
import { haptic, type HapticType } from '../../utils/haptics';

interface MotionButtonProps
  extends Omit<React.ComponentProps<typeof motion.button>, 'whileTap' | 'whileHover'> {
  hapticType?: HapticType;
  enableHover?: boolean;
  tapScale?: number;
  hoverScale?: number;
}

const MotionButton: React.FC<MotionButtonProps> = ({
  hapticType = 'medium',
  enableHover = true,
  tapScale,
  hoverScale,
  onClick,
  disabled,
  children,
  onHoverStart: onHoverStartProp,
  onHoverEnd: onHoverEndProp,
  ...rest
}) => {
  const shouldReduceMotion = useReducedMotion();
  const ref = useRef<HTMLButtonElement>(null);

  const handleClick = useCallback(
    (e: React.MouseEvent<HTMLButtonElement>) => {
      if (!disabled) {
        haptic[hapticType]();
      }
      onClick?.(e);
    },
    [disabled, hapticType, onClick],
  );

  const onHoverStart = useCallback(
    (...args: Parameters<NonNullable<React.ComponentProps<typeof motion.button>['onHoverStart']>>) => {
      if (ref.current) ref.current.style.willChange = 'transform, opacity';
      onHoverStartProp?.(...args);
    },
    [onHoverStartProp],
  );

  const onHoverEnd = useCallback(
    (...args: Parameters<NonNullable<React.ComponentProps<typeof motion.button>['onHoverEnd']>>) => {
      if (ref.current) ref.current.style.willChange = 'auto';
      onHoverEndProp?.(...args);
    },
    [onHoverEndProp],
  );

  const whileTap = disabled
    ? undefined
    : shouldReduceMotion
      ? reducedMotionTap
      : tapScale !== undefined
        ? { scale: tapScale, transition: springPresets.snappy }
        : tapAnimation;

  const whileHover =
    disabled || !enableHover
      ? undefined
      : shouldReduceMotion
        ? reducedMotionHover
        : hoverScale !== undefined
          ? { scale: hoverScale, transition: springPresets.gentle }
          : hoverAnimation;

  return (
    <motion.button
      ref={ref}
      whileTap={whileTap}
      whileHover={whileHover}
      onClick={handleClick}
      disabled={disabled}
      onHoverStart={onHoverStart}
      onHoverEnd={onHoverEnd}
      {...rest}
    >
      {children}
    </motion.button>
  );
};

export default MotionButton;
