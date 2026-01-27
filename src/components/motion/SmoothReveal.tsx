import React from 'react';

interface SmoothRevealProps {
  isLoaded: boolean;
  children: React.ReactNode;
  className?: string;
  delay?: number;
}

export const SmoothReveal: React.FC<SmoothRevealProps> = ({ 
  isLoaded, 
  children, 
  className = '',
  delay = 0 
}) => {
  return (
    <div 
      className={`smooth-reveal ${isLoaded ? 'smooth-reveal-visible' : 'smooth-reveal-hidden'} ${className}`}
      style={{ transitionDelay: delay ? `${delay}ms` : undefined }}
    >
      {children}
    </div>
  );
};

export default SmoothReveal;
