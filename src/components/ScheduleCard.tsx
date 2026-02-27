import React from 'react';
import { useTheme } from '../contexts/ThemeContext';

interface MetadataChip {
  icon: string;
  label: string;
}

interface Action {
  icon: string;
  label: string;
  onClick: () => void;
}

interface ScheduleCardProps {
  status?: string;
  statusColor?: string;
  icon: string;
  title: string;
  dateTime: string;
  metadata?: MetadataChip[];
  actions?: Action[];
  staggerIndex?: number;
  onClick?: () => void;
  linkedInfo?: string;
}

const ScheduleCard: React.FC<ScheduleCardProps> = ({
  status,
  statusColor,
  icon,
  title,
  dateTime,
  metadata,
  actions,
  staggerIndex,
  onClick,
  linkedInfo,
}) => {
  const { effectiveTheme } = useTheme();
  const isDark = effectiveTheme === 'dark';

  return (
    <div
      onClick={onClick}
      {...(onClick ? {
        role: 'button' as const,
        tabIndex: 0,
        onKeyDown: (e: React.KeyboardEvent) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onClick(); } }
      } : {})}
      className={`glass-card p-4 animate-slide-up-stagger ${onClick ? 'tactile-row cursor-pointer card-pressable glass-interactive transition-transform active:scale-[0.98]' : ''}`}
      style={staggerIndex !== undefined ? { '--stagger-index': staggerIndex, animationFillMode: 'both' } as React.CSSProperties : { animationFillMode: 'both' }}
    >
      <div className="flex items-start justify-between mb-2.5">
        {status && (
          <div className="flex items-center gap-1.5">
            <span className={`w-2 h-2 rounded-full ${statusColor || 'bg-green-500'}`} />
            <span className={`text-xs font-bold uppercase tracking-wider ${isDark ? 'text-white/70' : 'text-primary/60'}`}>
              {status}
            </span>
          </div>
        )}
        <div className={`w-10 h-10 rounded-2xl flex items-center justify-center ml-auto ${isDark ? 'bg-white/10' : 'bg-primary/[0.06]'}`}>
          <span className={`material-symbols-outlined text-xl ${isDark ? 'text-white/70' : 'text-primary/70'}`}>{icon}</span>
        </div>
      </div>

      <h4 className={`text-lg font-bold leading-tight mb-0.5 ${isDark ? 'text-white' : 'text-primary'}`}>
        {title}
      </h4>

      <p className={`text-sm font-medium mb-3 ${isDark ? 'text-accent' : 'text-brand-green'}`}>
        {dateTime}
      </p>

      {linkedInfo && (
        <p className={`text-xs mb-2 ${isDark ? 'text-purple-300' : 'text-purple-600'}`}>
          {linkedInfo}
        </p>
      )}

      {metadata && metadata.length > 0 && (
        <div className={`flex items-center gap-0 text-xs flex-wrap ${isDark ? 'text-white/60' : 'text-primary/50'}`}>
          {metadata.map((chip, idx) => (
            <React.Fragment key={idx}>
              {idx > 0 && <span className={`mx-2 ${isDark ? 'text-white/20' : 'text-primary/20'}`}>|</span>}
              <span className="flex items-center gap-1">
                <span className="material-symbols-outlined text-sm">{chip.icon}</span>
                {chip.label}
              </span>
            </React.Fragment>
          ))}
        </div>
      )}

      {actions && actions.length > 0 && (
        <div className="flex justify-end gap-1.5 mt-3 -mb-1">
          {actions.map((action, idx) => (
            <button
              key={idx}
              onClick={(e) => { e.stopPropagation(); action.onClick(); }}
              className={`w-9 h-9 rounded-xl flex items-center justify-center active:scale-90 transition-transform ${isDark ? 'bg-white/10 text-white/70 hover:text-white' : 'bg-primary/[0.06] text-primary/60 hover:text-primary'}`}
              aria-label={action.label}
            >
              <span className="material-symbols-outlined text-base">{action.icon}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
};

export default ScheduleCard;
