import React from 'react';
import { motion, AnimatePresence, useReducedMotion } from 'framer-motion';
import type { SystemHealth } from './dataIntegrityTypes';
import { springPresets, contentEnterVariant, noMotionVariant, staggerContainer, listItemVariant } from '../../../../utils/motion';
import Icon from '../../../../components/icons/Icon';

interface HealthStatusGridProps {
  systemHealth: SystemHealth | null;
  isCheckingHealth: boolean;
  onCheckHealth: () => void;
}

const HealthStatusGrid: React.FC<HealthStatusGridProps> = ({
  systemHealth,
  isCheckingHealth,
  onCheckHealth,
}) => {
  const prefersReduced = useReducedMotion();

  return (
    <motion.div
      className="mb-6 bg-white/60 dark:bg-white/5 backdrop-blur-lg border border-primary/10 dark:border-white/20 rounded-xl p-6"
      variants={prefersReduced ? noMotionVariant : contentEnterVariant}
      initial="hidden"
      animate="show"
      transition={prefersReduced ? { duration: 0 } : { ...springPresets.gentle, delay: 0.08 }}
    >
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <Icon name="monitoring" className="text-primary dark:text-white text-[24px]" />
          <h3 className="text-2xl leading-tight text-primary dark:text-white" style={{ fontFamily: 'var(--font-headline)' }}>System Health</h3>
        </div>
        <button
          onClick={onCheckHealth}
          disabled={isCheckingHealth}
          className="tactile-btn px-4 py-2 bg-primary dark:bg-[#CCB8E4] text-white dark:text-[#293515] rounded-lg font-medium text-sm flex items-center gap-2 hover:opacity-90 transition-opacity disabled:opacity-50"
        >
          {isCheckingHealth ? (
            <>
              <Icon name="progress_activity" className="animate-spin text-[16px]" />
              Checking...
            </>
          ) : (
            <>
              <Icon name="health_and_safety" className="text-[16px]" />
              Check Health
            </>
          )}
        </button>
      </div>

      <AnimatePresence mode="wait">
      {systemHealth ? (
        <motion.div key="health-grid" className="space-y-3" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={prefersReduced ? { duration: 0 } : { duration: 0.2 }}>
          <motion.div
            className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5 gap-2"
            variants={prefersReduced ? noMotionVariant : staggerContainer(0.05)}
            initial="hidden"
            animate="show"
          >
            {[
              { key: 'database' as const, label: 'Database', icon: 'database' },
              { key: 'stripe' as const, label: 'Stripe', icon: 'credit_card' },
              { key: 'hubspot' as const, label: 'HubSpot', icon: 'groups' },
              { key: 'resend' as const, label: 'Resend', icon: 'mail' },
              { key: 'googleCalendar' as const, label: 'Google Calendar', icon: 'calendar_today' },
            ].map(({ key, label, icon: _icon }) => {
              const service = systemHealth.services[key];
              const isDegraded = service.status === 'degraded';
              const isUnhealthy = service.status === 'unhealthy';
              
              let statusBgColor = 'bg-green-50 dark:bg-green-900/20 border-green-200 dark:border-green-800';
              let statusTextColor = 'text-green-700 dark:text-green-300';
              let statusIcon = 'check_circle';
              
              if (isDegraded) {
                statusBgColor = 'bg-yellow-50 dark:bg-yellow-900/20 border-yellow-200 dark:border-yellow-800';
                statusTextColor = 'text-yellow-700 dark:text-yellow-300';
                statusIcon = 'warning';
              } else if (isUnhealthy) {
                statusBgColor = 'bg-red-50 dark:bg-red-900/20 border-red-200 dark:border-red-800';
                statusTextColor = 'text-red-700 dark:text-red-300';
                statusIcon = 'cancel';
              }

              return (
                <motion.div
                  key={key}
                  className={`border rounded-lg p-3 ${statusBgColor}`}
                  variants={prefersReduced ? noMotionVariant : listItemVariant}
                >
                  <div className="flex items-start gap-2 mb-2">
                    <Icon name={statusIcon} className={`text-[20px] ${statusTextColor}`} />
                    <div className="flex-1 min-w-0">
                      <p className={`text-xs font-bold ${statusTextColor}`}>{label}</p>
                      <p className={`text-[10px] ${statusTextColor} opacity-80`}>{service.status}</p>
                    </div>
                  </div>
                  {service.latencyMs !== undefined && (
                    <p className={`text-[10px] ${statusTextColor} opacity-70`}>
                      <Icon name="schedule" className="text-[12px] align-text-bottom mr-0.5" />
                      {service.latencyMs}ms
                    </p>
                  )}
                  {service.message && isUnhealthy && (
                    <p className={`text-[10px] ${statusTextColor} opacity-80 mt-1 line-clamp-2`}>{service.message}</p>
                  )}
                </motion.div>
              );
            })}
          </motion.div>
          <p className="text-xs text-gray-500 dark:text-gray-400 text-right">
            Checked {new Date(systemHealth.timestamp).toLocaleTimeString('en-US', { timeZone: 'America/Los_Angeles' })}
          </p>
        </motion.div>
      ) : (
        <motion.div key="health-empty" className="text-center py-4" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={prefersReduced ? { duration: 0 } : { duration: 0.2 }}>
          <p className="text-sm text-gray-600 dark:text-gray-400">Click "Check Health" to see system status</p>
        </motion.div>
      )}
      </AnimatePresence>
    </motion.div>
  );
};

export default HealthStatusGrid;
