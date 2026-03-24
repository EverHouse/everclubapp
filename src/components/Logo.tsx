import React from 'react';
import { BRAND, LogoType, LogoVariant } from '../config/branding';

interface LogoProps {
  type?: LogoType;
  variant?: LogoVariant;
  isMemberRoute?: boolean;
  isDarkBackground?: boolean;
  className?: string;
  alt?: string;
}

const Logo: React.FC<LogoProps> = ({
  type,
  variant,
  isMemberRoute = false,
  isDarkBackground = true,
  className = 'h-12 w-auto',
  alt = BRAND.name,
}) => {
  const logoType: LogoType = type || (isMemberRoute ? 'mascot' : 'wordmark');
  const logoVariant: LogoVariant = variant || (isDarkBackground ? 'white' : 'dark');
  const src = BRAND.logos[logoType][logoVariant];

  const dimensions = logoType === 'mascot'
    ? { width: 48, height: 48 }
    : { width: 120, height: 48 };

  return (
    <img
      src={src}
      alt={alt}
      className={className}
      width={dimensions.width}
      height={dimensions.height}
    />
  );
};

export default Logo;
