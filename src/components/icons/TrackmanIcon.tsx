import React from 'react';

interface TrackmanIconProps {
  className?: string;
  size?: number;
}

export const TrackmanIcon: React.FC<TrackmanIconProps> = ({ className = '', size = 20 }) => {
  return (
    <img
      src="/images/trackman-logo.png"
      alt="Trackman"
      width={size}
      height={size}
      className={className}
      style={{ objectFit: 'contain' }}
    />
  );
};

export default TrackmanIcon;
