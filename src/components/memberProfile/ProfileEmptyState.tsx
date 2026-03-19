import React from 'react';
import { useTheme } from '../../contexts/ThemeContext';
import Icon from '../icons/Icon';

const ProfileEmptyState: React.FC<{ icon: string; message: string }> = ({ icon, message }) => {
  const { effectiveTheme } = useTheme();
  const isDark = effectiveTheme === 'dark';
  
  return (
    <div className="flex flex-col items-center justify-center py-12 text-center">
      <Icon name={icon} className={`text-4xl mb-3 ${isDark ? 'text-white/20' : 'text-gray-300'}`} />
      <p className={`text-sm ${isDark ? 'text-gray-400' : 'text-gray-500'}`}>{message}</p>
    </div>
  );
};

export default ProfileEmptyState;
