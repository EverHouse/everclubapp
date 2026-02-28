import React from 'react';
import { haptic } from '../utils/haptics';

interface DateButtonProps {
  day: string;
  date: string;
  active?: boolean;
  onClick?: () => void;
  isDark?: boolean;
}

const DateButton: React.FC<DateButtonProps> = ({ day, date, active, onClick, isDark = true }) => {
  const handleClick = () => {
    haptic.selection();
    onClick?.();
  };

  return (
    <button 
      onClick={handleClick} 
      className={`tactile-btn flex-shrink-0 flex flex-col items-center justify-center w-16 h-20 rounded-[4px] transition-all duration-fast ease-spring-smooth active:scale-95 border ${active ? (isDark ? 'bg-white text-primary border-white' : 'bg-primary text-white border-primary') : (isDark ? 'bg-transparent text-white border-white/15 hover:border-white/30' : 'bg-white text-primary border-black/10 hover:border-black/20 shadow-sm')}`}
    >
      <span className={`text-[10px] font-semibold mb-1 uppercase tracking-[0.15em] ${active ? 'opacity-80' : 'opacity-50'}`} style={{ fontFamily: 'var(--font-label)' }}>{day}</span>
      <span className="text-2xl font-light">{date}</span>
    </button>
  );
};

export default DateButton;