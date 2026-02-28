import React from 'react';

interface IconButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  icon: string;
  'aria-label': string;
  size?: 'sm' | 'md' | 'lg';
  variant?: 'ghost' | 'filled' | 'tonal';
}

const sizeStyles = {
  sm: 'min-w-[36px] min-h-[36px] p-1.5 text-lg',
  md: 'min-w-[44px] min-h-[44px] p-2 text-xl',
  lg: 'min-w-[52px] min-h-[52px] p-3 text-2xl',
};

const variantStyles = {
  ghost: 'bg-transparent hover:bg-primary/10 dark:hover:bg-bone/10 text-primary dark:text-bone',
  filled: 'bg-primary text-bone hover:bg-primary/90 dark:bg-bone dark:text-primary dark:hover:bg-bone/90',
  tonal: 'bg-primary/10 text-primary hover:bg-primary/20 dark:bg-bone/10 dark:text-bone dark:hover:bg-bone/20',
};

export const IconButton: React.FC<IconButtonProps> = ({
  icon,
  size = 'md',
  variant = 'ghost',
  className = '',
  ...props
}) => {
  return (
    <button
      type="button"
      className={`inline-flex items-center justify-center rounded-xl transition-all duration-fast focus:ring-2 focus:ring-offset-1 focus:ring-accent focus:outline-none disabled:opacity-50 disabled:cursor-not-allowed active:scale-[0.95] ${variantStyles[variant]} ${sizeStyles[size]} ${className}`}
      {...props}
    >
      <span className="material-symbols-outlined" aria-hidden="true">
        {icon}
      </span>
    </button>
  );
};

export default IconButton;
