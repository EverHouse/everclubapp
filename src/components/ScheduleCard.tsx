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
      className={`glass-card p-5 animate-slide-up-stagger ${onClick ? 'tactile-row cursor-pointer card-pressable glass-interactive transition-transform active:scale-[0.98]' : ''}`}
      style={staggerIndex !== undefined ? { '--stagger-index': staggerIndex, animationFillMode: 'both' } as React.CSSProperties : { animationFillMode: 'both' }}
    >
      <div className="flex items-start justify-between mb-3">
        {status && (
          <div className="flex items-center gap-1.5">
            <span className={`w-2 h-2 rounded-full ${statusColor || 'bg-green-500'}`} />
            <span className={`text-[11px] font-bold uppercase tracking-widest ${isDark ? 'text-white/60' : 'text-primary/50'}`}>
              {status}
            </span>
          </div>
        )}
        <div className={`w-11 h-11 rounded-2xl flex items-center justify-center ml-auto ${isDark ? 'bg-white/[0.08]' : 'bg-primary/[0.05]'}`}>
          <span className={`material-symbols-outlined text-[22px] ${isDark ? 'text-white/60' : 'text-primary/60'}`}>{icon}</span>
        </div>
      </div>

      <h4 className={`text-[17px] font-bold leading-snug mb-1 ${isDark ? 'text-white' : 'text-primary'}`}>
        {title}
      </h4>

      <p className={`text-sm font-semibold mb-1 ${isDark ? 'text-accent' : 'text-brand-green'}`}>
        {dateTime}
      </p>

      {linkedInfo && (
        <p className={`text-xs font-medium mb-1 ${isDark ? 'text-purple-300' : 'text-purple-600'}`}>
          {linkedInfo}
        </p>
      )}

      {((metadata && metadata.length > 0) || (actions && actions.length > 0)) && (
        <div className={`flex items-center justify-between mt-3 pt-3 border-t ${isDark ? 'border-white/[0.08]' : 'border-primary/[0.06]'}`}>
          {metadata && metadata.length > 0 ? (
            <div className={`flex items-center gap-0 text-xs flex-wrap ${isDark ? 'text-white/50' : 'text-primary/45'}`}>
              {metadata.map((chip, idx) => (
                <React.Fragment key={idx}>
                  {idx > 0 && <span className={`mx-2 ${isDark ? 'text-white/15' : 'text-primary/15'}`}>|</span>}
                  <span className="flex items-center gap-1">
                    <span className="material-symbols-outlined text-[14px]">{chip.icon}</span>
                    {chip.label}
                  </span>
                </React.Fragment>
              ))}
            </div>
          ) : <div />}
          {actions && actions.length > 0 && (
            <div className="flex gap-1.5">
              {actions.map((action, idx) => (
                <button
                  key={idx}
                  onClick={(e) => { e.stopPropagation(); action.onClick(); }}
                  className={`w-9 h-9 rounded-xl flex items-center justify-center active:scale-90 transition-transform ${isDark ? 'bg-white/[0.08] text-white/60 hover:text-white hover:bg-white/[0.14]' : 'bg-primary/[0.05] text-primary/50 hover:text-primary hover:bg-primary/[0.1]'}`}
                  aria-label={action.label}
                >
                  <span className="material-symbols-outlined text-[16px]">{action.icon}</span>
                </button>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
};

export default ScheduleCard;
