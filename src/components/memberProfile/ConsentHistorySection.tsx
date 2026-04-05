import React, { useState, useEffect } from 'react';
import { motion, useReducedMotion } from 'framer-motion';
import { apiRequest } from '../../lib/apiRequest';
import { springPresets } from '../../utils/motion';
import Icon from '../icons/Icon';

interface ConsentEvent {
  id: number;
  userId: string | null;
  email: string;
  consentType: string;
  action: string;
  method: string;
  source: string | null;
  ipAddress: string | null;
  details: Record<string, unknown> | null;
  createdAt: string;
}

interface ConsentHistorySectionProps {
  email: string;
  isDark: boolean;
}

const METHOD_LABELS: Record<string, string> = {
  form_submission: 'Form Submission',
  profile_toggle: 'Profile Toggle',
  spam_complaint: 'Spam Complaint',
  admin_action: 'Admin Action',
  hubspot_sync: 'HubSpot Sync',
  system_backfill: 'System Backfill',
};

const CONSENT_TYPE_LABELS: Record<string, string> = {
  marketing: 'Marketing',
  transactional: 'Transactional',
  reminders: 'Reminders',
};

function formatTimestamp(dateStr: string): string {
  const d = new Date(dateStr);
  return d.toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
    timeZone: 'America/Los_Angeles',
  });
}

const ConsentHistorySection: React.FC<ConsentHistorySectionProps> = ({ email, isDark }) => {
  const [events, setEvents] = useState<ConsentEvent[]>([]);
  const [loading, setLoading] = useState(false);
  const [expanded, setExpanded] = useState(false);

  useEffect(() => {
    if (!expanded || !email) return;
    setLoading(true);
    apiRequest<ConsentEvent[]>(`/api/members/${encodeURIComponent(email)}/consent-history`)
      .then(({ ok, data }) => {
        if (ok && Array.isArray(data)) setEvents(data);
      })
      .finally(() => setLoading(false));
  }, [email, expanded]);

  const prefersReduced = useReducedMotion();
  return (
    <motion.div
      initial={prefersReduced ? false : { opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={prefersReduced ? { duration: 0 } : { delay: 5 * 0.06, ...springPresets.gentle }}
    >
      <div className={`rounded-xl ${isDark ? 'bg-white/5' : 'bg-gray-50'}`}>
        <button
          onClick={() => setExpanded(!expanded)}
          className={`w-full flex items-center justify-between p-4 text-left transition-colors rounded-xl ${
            isDark ? 'hover:bg-white/5' : 'hover:bg-gray-100'
          }`}
        >
          <div className="flex items-center gap-2">
            <Icon name="verified" className={`text-lg ${isDark ? 'text-emerald-400' : 'text-emerald-600'}`} />
            <h4 className={`text-sm font-bold ${isDark ? 'text-gray-300' : 'text-gray-700'}`}>
              Consent History
            </h4>
            {events.length > 0 && expanded && (
              <span className={`text-xs px-1.5 py-0.5 rounded-full ${isDark ? 'bg-white/10 text-gray-400' : 'bg-gray-200 text-gray-500'}`}>
                {events.length}
              </span>
            )}
          </div>
          <Icon
            name="expand_more"
            className={`text-lg transition-transform ${expanded ? 'rotate-180' : ''} ${isDark ? 'text-gray-500' : 'text-gray-400'}`}
          />
        </button>

        {expanded && (
          <div className="px-4 pb-4">
            {loading ? (
              <div className="flex items-center justify-center py-6">
                <Icon name="progress_activity" className="text-2xl text-gray-400 animate-spin" />
              </div>
            ) : events.length === 0 ? (
              <p className={`text-xs text-center py-4 ${isDark ? 'text-gray-500' : 'text-gray-400'}`}>
                No consent records found
              </p>
            ) : (
              <div className="space-y-2">
                {events.map((event) => (
                  <div
                    key={event.id}
                    className={`flex items-start gap-3 p-3 rounded-lg ${isDark ? 'bg-white/5' : 'bg-white'}`}
                  >
                    <div className={`mt-0.5 w-6 h-6 rounded-full flex items-center justify-center flex-shrink-0 ${
                      event.action === 'granted'
                        ? isDark ? 'bg-emerald-500/20 text-emerald-400' : 'bg-emerald-100 text-emerald-600'
                        : isDark ? 'bg-red-500/20 text-red-400' : 'bg-red-100 text-red-600'
                    }`}>
                      <Icon
                        name={event.action === 'granted' ? 'check' : 'close'}
                        className="text-sm"
                      />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className={`text-xs font-semibold ${
                          event.action === 'granted'
                            ? isDark ? 'text-emerald-400' : 'text-emerald-700'
                            : isDark ? 'text-red-400' : 'text-red-700'
                        }`}>
                          {event.action === 'granted' ? 'Opted In' : 'Opted Out'}
                        </span>
                        <span className={`text-xs px-1.5 py-0.5 rounded ${isDark ? 'bg-white/10 text-gray-400' : 'bg-gray-100 text-gray-500'}`}>
                          {CONSENT_TYPE_LABELS[event.consentType] || event.consentType}
                        </span>
                      </div>
                      <p className={`text-xs mt-1 ${isDark ? 'text-gray-400' : 'text-gray-500'}`}>
                        via {METHOD_LABELS[event.method] || event.method}
                        {event.source && ` — ${event.source}`}
                      </p>
                      <p className={`text-[10px] mt-1 ${isDark ? 'text-gray-600' : 'text-gray-400'}`}>
                        {formatTimestamp(event.createdAt)}
                        {event.ipAddress && ` · IP: ${event.ipAddress}`}
                      </p>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </motion.div>
  );
};

export default ConsentHistorySection;
