import React from 'react';
import { motion, AnimatePresence, useReducedMotion } from 'framer-motion';
import {
  springPresets,
  staggerContainer,
  listItemVariant,
  pageEnterVariant,
  contentEnterVariant,
  popInVariant,
  slideUpVariant,
  noMotionVariant,
} from '../../utils/motion';

interface MotionListProps {
  children: React.ReactNode;
  className?: string;
}

export const MotionList = React.forwardRef<HTMLDivElement, MotionListProps>(({ children, className }, ref) => {
  const prefersReduced = useReducedMotion();

  return (
    <motion.div
      ref={ref}
      className={className || ''}
      variants={prefersReduced ? noMotionVariant : staggerContainer(0.04)}
      initial="hidden"
      animate="show"
    >
      {children}
    </motion.div>
  );
});

interface MotionListItemProps {
  children: React.ReactNode;
  className?: string;
  onClick?: () => void;
  style?: React.CSSProperties;
  index?: number;
}

export const MotionListItem: React.FC<MotionListItemProps> = React.memo(({ 
  children, 
  className, 
  onClick,
  style,
  index = 0
}) => {
  const prefersReduced = useReducedMotion();

  return (
    <motion.div
      className={className || ''}
      variants={prefersReduced ? noMotionVariant : listItemVariant}
      initial="hidden"
      animate="show"
      transition={prefersReduced ? { duration: 0 } : { ...springPresets.listItem, delay: index * 0.04 }}
      onClick={onClick}
      {...(onClick ? {
        role: 'button' as const,
        tabIndex: 0,
        onKeyDown: (e: React.KeyboardEvent) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onClick(); } }
      } : {})}
      style={style}
    >
      {children}
    </motion.div>
  );
});

MotionListItem.displayName = 'MotionListItem';

interface AnimatedPageProps {
  children: React.ReactNode;
  className?: string;
}

export const AnimatedPage: React.FC<AnimatedPageProps> = ({ children, className }) => {
  const prefersReduced = useReducedMotion();

  return (
    <motion.div
      className={className || ''}
      variants={prefersReduced ? noMotionVariant : pageEnterVariant}
      initial="hidden"
      animate="show"
    >
      {children}
    </motion.div>
  );
};

interface AnimatedSectionProps {
  children: React.ReactNode;
  className?: string;
  delay?: number;
  style?: React.CSSProperties;
  id?: string;
  viewport?: boolean;
}

export const AnimatedSection: React.FC<AnimatedSectionProps> = ({ 
  children, 
  className,
  delay = 0,
  style,
  id,
  viewport = false,
}) => {
  const prefersReduced = useReducedMotion();
  const variants = prefersReduced ? noMotionVariant : contentEnterVariant;
  const transition = prefersReduced ? { duration: 0 } : { ...springPresets.gentle, delay: delay * 0.08 };

  return (
    <motion.div
      id={id}
      className={className || ''}
      variants={variants}
      initial="hidden"
      {...(viewport
        ? { whileInView: 'show', viewport: { once: true, amount: 0.15 } }
        : { animate: 'show' }
      )}
      transition={transition}
      style={style}
    >
      {children}
    </motion.div>
  );
};

interface PopInSectionProps {
  children: React.ReactNode;
  className?: string;
  delay?: number;
  viewport?: boolean;
  onAnimationEnd?: React.AnimationEventHandler<HTMLDivElement>;
}

export const PopInSection: React.FC<PopInSectionProps> = ({
  children,
  className,
  delay = 0,
  viewport = false,
  onAnimationEnd,
}) => {
  const prefersReduced = useReducedMotion();

  return (
    <motion.div
      className={className || ''}
      variants={prefersReduced ? noMotionVariant : popInVariant}
      initial="hidden"
      {...(viewport
        ? { whileInView: 'show', viewport: { once: true, amount: 0.15 } }
        : { animate: 'show' }
      )}
      transition={prefersReduced ? { duration: 0 } : { ...springPresets.popIn, delay: delay * 0.08 }}
      onAnimationEnd={onAnimationEnd}
    >
      {children}
    </motion.div>
  );
};

interface SlideUpSectionProps {
  children: React.ReactNode;
  className?: string;
  delay?: number;
  style?: React.CSSProperties;
  id?: string;
  viewport?: boolean;
}

export const SlideUpSection: React.FC<SlideUpSectionProps> = ({
  children,
  className,
  delay = 0,
  style,
  id,
  viewport = false,
}) => {
  const prefersReduced = useReducedMotion();

  return (
    <motion.div
      id={id}
      className={className || ''}
      variants={prefersReduced ? noMotionVariant : slideUpVariant}
      initial="hidden"
      {...(viewport
        ? { whileInView: 'show', viewport: { once: true, amount: 0.15 } }
        : { animate: 'show' }
      )}
      transition={prefersReduced ? { duration: 0 } : { ...springPresets.smooth, delay: delay * 0.08 }}
      style={style}
    >
      {children}
    </motion.div>
  );
};

interface AccordionContentProps {
  isOpen: boolean;
  children: React.ReactNode;
  className?: string;
}

export const AccordionContent: React.FC<AccordionContentProps> = ({
  isOpen,
  children,
  className = '',
}) => {
  const prefersReduced = useReducedMotion();

  return (
    <AnimatePresence initial={false}>
      {isOpen && (
        <motion.div
          className={className}
          initial={prefersReduced ? false : { height: 0, opacity: 0 }}
          animate={{ height: 'auto', opacity: 1 }}
          exit={{ height: 0, opacity: 0 }}
          transition={prefersReduced ? { duration: 0 } : { height: { type: 'spring', stiffness: 500, damping: 40 }, opacity: { duration: 0.2 } }}
          style={{ overflow: 'hidden' }}
          aria-hidden={false}
        >
          {children}
        </motion.div>
      )}
    </AnimatePresence>
  );
};
