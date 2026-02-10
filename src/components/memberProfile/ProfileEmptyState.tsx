import React from 'react';
import { useTheme } from '../../contexts/ThemeContext';

const ProfileEmptyState: React.FC<{ icon: string; message: string }> = ({ icon, message }) => {
  const { effectiveTheme } = useTheme();
  const isDark = effectiveTheme === 'dark';
  
  return (
    <div className="flex flex-col items-center justify-center py-12 text-center">
      <span className={`material-symbols-outlined text-4xl mb-3 ${isDark ? 'text-white/20' : 'text-gray-300'}`}>{icon}</span>
      <p className={`text-sm ${isDark ? 'text-gray-400' : 'text-gray-500'}`}>{message}</p>
    </div>
  );
};

export default ProfileEmptyState;
