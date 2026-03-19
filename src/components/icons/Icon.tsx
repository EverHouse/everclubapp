import React from 'react';
import ICON_PATHS from './iconPaths';

interface IconProps {
  name: string;
  className?: string;
  size?: number;
  filled?: boolean;
  style?: React.CSSProperties;
  'aria-hidden'?: boolean;
}

const Icon: React.FC<IconProps> = ({
  name,
  className = '',
  size,
  filled,
  style,
  'aria-hidden': ariaHidden = true,
}) => {
  const path = ICON_PATHS[name];

  if (!path) {
    if (process.env.NODE_ENV === 'development') {
      console.warn(`[Icon] Unknown icon name: "${name}"`);
    }
    return null;
  }

  const computedSize = size ?? undefined;

  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 -960 960 960"
      width={computedSize ?? '1em'}
      height={computedSize ?? '1em'}
      fill="currentColor"
      className={className}
      style={style}
      aria-hidden={ariaHidden}
    >
      <path d={path} />
    </svg>
  );
};

export default React.memo(Icon);
