import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion, AnimatePresence, useReducedMotion } from 'framer-motion';
import { useTheme } from '../contexts/ThemeContext';
import { useAuthData } from '../contexts/DataContext';
import { getTodayPacific } from '../utils/dateUtils';
import { isBlockingClosure, getNoticeLabel as getNoticeLabelUtil } from '../utils/closureUtils';
import { fetchWithCredentials, isAbortError } from '../hooks/queries/useFetch';
import { springPresets, collapseVariants } from '../utils/motion';
import Icon from './icons/Icon';

interface Closure {
  id: number;
  title: string;
  reason: string | null;
  noticeType: string | null;
  startDate: string;
  endDate: string;
  startTime: string | null;
  endTime: string | null;
  affectedAreas: string;
  notifyMembers: boolean;
}


const ClosureAlert: React.FC = () => {
  const navigate = useNavigate();
  const { effectiveTheme } = useTheme();
  const { user, actualUser } = useAuthData();
  const isDark = effectiveTheme === 'dark';
  
  // Check if viewing as staff/admin (not in "View As" mode)
  const isStaffOrAdmin = actualUser?.role === 'admin' || actualUser?.role === 'staff';
  const isViewingAsMember = user?.email && actualUser?.email && user.email !== actualUser.email;
  
  const [closures, setClosures] = useState<Closure[]>([]);
  const [dismissedIds, setDismissedIds] = useState<Set<number>>(new Set());
  const [isLoading, setIsLoading] = useState(true);
  const [isExiting, setIsExiting] = useState(false);
  const getStorageKey = useCallback(() => `eh_dismissed_notices_${user?.email || 'guest'}`, [user?.email]);

  useEffect(() => {
    const stored = localStorage.getItem(getStorageKey());
    if (stored) {
      try {
        const parsed = JSON.parse(stored);
        setDismissedIds(new Set(parsed));
      } catch {
        setDismissedIds(new Set());
      }
    }

    if (!user?.email) return;
    const controller = new AbortController();
    const fetchDismissed = async () => {
      try {
        const data = await fetchWithCredentials<{ noticeType: string; noticeId: number }[]>(
          '/api/notices/dismissed',
          { signal: controller.signal }
        );
        const closureIds = (data ?? [])
          .filter(d => d.noticeType === 'closure')
          .map(d => d.noticeId);
        if (closureIds.length > 0) {
          setDismissedIds(prev => {
            const merged = new Set(prev);
            closureIds.forEach(id => merged.add(id));
            localStorage.setItem(getStorageKey(), JSON.stringify([...merged]));
            return merged;
          });
        }
      } catch (error: unknown) {
        if (isAbortError(error)) return;
      }
    };
    fetchDismissed();
    return () => controller.abort();
  }, [user?.email, getStorageKey]);

  useEffect(() => {
    const controller = new AbortController();
    const fetchClosures = async () => {
      try {
        const data = await fetchWithCredentials<Closure[]>('/api/closures', { signal: controller.signal });
        setClosures(data ?? []);
      } catch (error: unknown) {
        if (isAbortError(error)) return;
        console.error('Failed to fetch closures:', error);
      } finally {
        if (!controller.signal.aborted) {
          setIsLoading(false);
        }
      }
    };
    
    fetchClosures();
    return () => controller.abort();
  }, []);

  const activeClosures = useMemo(() => {
    const todayStr = getTodayPacific();
    
    return closures.filter(closure => {
      if (dismissedIds.has(closure.id)) return false;
      if (closure.endDate < todayStr) return false;
      
      // Staff/admin see all upcoming notices (unless in "View As" mode)
      if (isStaffOrAdmin && !isViewingAsMember) {
        const hasAffectedResources = closure.affectedAreas && closure.affectedAreas !== 'none';
        return hasAffectedResources || closure.notifyMembers === true;
      }
      
      // Members only see notices ON the day of the closure (startDate <= today)
      if (closure.startDate > todayStr) return false;
      
      const hasAffectedResources = closure.affectedAreas && closure.affectedAreas !== 'none';
      return hasAffectedResources || closure.notifyMembers === true;
    });
  }, [closures, dismissedIds, isStaffOrAdmin, isViewingAsMember]);

  const prefersReduced = useReducedMotion();

  const handleDismiss = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    const closure = activeClosures[0];
    if (!closure) return;
    setIsExiting(true);
  }, [activeClosures]);

  const handleExitComplete = useCallback(() => {
    const closure = activeClosures[0];
    if (!closure) {
      setIsExiting(false);
      return;
    }
    const newDismissed = new Set(dismissedIds);
    newDismissed.add(closure.id);
    setDismissedIds(newDismissed);
    localStorage.setItem(getStorageKey(), JSON.stringify([...newDismissed]));
    setIsExiting(false);

    const persistDismiss = (attempt = 1) => {
      fetchWithCredentials('/api/notices/dismiss', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ noticeType: 'closure', noticeId: closure.id })
      }).catch((err) => {
        if (attempt < 3) {
          setTimeout(() => persistDismiss(attempt + 1), 1000 * attempt);
        } else {
          console.warn('[ClosureAlert] Failed to persist dismissal after retries:', err);
        }
      });
    };
    persistDismiss();
  }, [activeClosures, dismissedIds, getStorageKey]);

  const handleViewDetails = () => {
    navigate('/updates?tab=notices');
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      handleViewDetails();
    }
  };
  
  const handleKeyUp = (e: React.KeyboardEvent) => {
    if (e.key === ' ') {
      e.preventDefault();
      handleViewDetails();
    }
  };

  const isBlocking = isBlockingClosure;

  const isVisible = !isLoading && activeClosures.length > 0 && !isExiting;

  const closure = activeClosures[0];
  const hasMultiple = activeClosures.length > 1;
  const blocking = closure ? isBlocking(closure.affectedAreas) : false;
  
  const noticeLabel = closure ? getNoticeLabelUtil(closure) : '';

  const collapseTransition = prefersReduced
    ? { duration: 0 }
    : springPresets.smooth;

  return (
    <AnimatePresence onExitComplete={handleExitComplete}>
    {isVisible && closure ? (
    <motion.div
      key={`closure-alert-${closure.id}`}
      variants={collapseVariants}
      initial="hidden"
      animate="visible"
      exit="exit"
      transition={collapseTransition}
      style={{ overflow: 'hidden' }}
    >
    <div 
      className={`mb-4 py-2 px-4 rounded-xl flex items-center justify-between gap-3 cursor-pointer transition-colors duration-normal ease-spring-smooth ${
        blocking
          ? (isDark ? 'bg-red-500/20 hover:bg-red-500/30' : 'bg-red-100 hover:bg-red-200')
          : (isDark ? 'bg-amber-500/20 hover:bg-amber-500/30' : 'bg-amber-100 hover:bg-amber-200')
      }`}
      onClick={handleViewDetails}
      onKeyDown={handleKeyDown}
      onKeyUp={handleKeyUp}
      role="button"
      tabIndex={0}
      aria-label={`View notice: ${noticeLabel}`}
    >
      <div className="flex items-center gap-3 min-w-0 flex-1">
        <Icon name={blocking ? 'event_busy' : 'notifications'} className={`text-lg flex-shrink-0 ${ blocking ? (isDark ? 'text-red-400' : 'text-red-600') : (isDark ? 'text-amber-400' : 'text-amber-600') }`} />
        <div className="flex flex-col min-w-0 flex-1">
          <span className={`text-[10px] font-bold uppercase ${
            blocking
              ? (isDark ? 'text-red-400' : 'text-red-600')
              : (isDark ? 'text-amber-400' : 'text-amber-600')
          }`}>
            {noticeLabel}
          </span>
          <div className={`text-sm font-medium ${isDark ? 'text-white' : 'text-gray-900'}`}>
            <span className="line-clamp-1">
              {closure.reason && closure.reason.trim() ? closure.reason : 'See details'}
            </span>
          </div>
        </div>
        {hasMultiple && (
          <span className={`text-xs font-medium flex-shrink-0 px-1.5 py-0.5 rounded ${
            blocking
              ? (isDark ? 'bg-red-400/30 text-red-300' : 'bg-red-200 text-red-700')
              : (isDark ? 'bg-amber-400/30 text-amber-300' : 'bg-amber-200 text-amber-700')
          }`}>
            +{activeClosures.length - 1}
          </span>
        )}
      </div>
      <button
        onClick={handleDismiss}
        className={`p-2 min-w-[44px] min-h-[44px] flex items-center justify-center rounded-full flex-shrink-0 transition-colors tactile-btn ${
          isDark 
            ? 'text-white/70 hover:text-white hover:bg-white/10' 
            : 'text-gray-500 hover:text-gray-700 hover:bg-gray-200'
        }`}
        aria-label="Dismiss notice"
      >
        <Icon name="close" className="text-lg" />
      </button>
    </div>
    </motion.div>
    ) : null}
    </AnimatePresence>
  );
};

export default ClosureAlert;
