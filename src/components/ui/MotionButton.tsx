import React, { useCallback } from 'react';
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
  ...rest
}) => {
  const shouldReduceMotion = useReducedMotion();

  const handleClick = useCallback(
    (e: React.MouseEvent<HTMLButtonElement>) => {
      if (!disabled) {
        haptic[hapticType]();
      }
      onClick?.(e);
    },
    [disabled, hapticType, onClick],
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
      whileTap={whileTap}
      whileHover={whileHover}
      onClick={handleClick}
      disabled={disabled}
      {...rest}
    >
      {children}
    </motion.button>
  );
};

export default MotionButton;
