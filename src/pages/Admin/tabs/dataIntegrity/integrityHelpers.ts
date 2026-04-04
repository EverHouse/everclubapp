import type { CheckSeverity } from '../../../../data/integrityCheckMetadata';
import type { IntegrityIssue, IssueContext } from './dataIntegrityTypes';

export const formatTimeForSheet = (t: string | undefined): string => {
  if (!t) return '';
  const [h, m] = t.split(':').map(Number);
  if (isNaN(h)) return t;
  const ampm = h >= 12 ? 'PM' : 'AM';
  const h12 = h === 0 ? 12 : h > 12 ? h - 12 : h;
  return `${h12}:${String(m).padStart(2, '0')} ${ampm}`;
};

export const getStatusColor = (status: 'pass' | 'warning' | 'fail' | 'info') => {
  switch (status) {
    case 'pass': return 'bg-green-100 dark:bg-green-900/30 text-green-600 dark:text-green-400';
    case 'warning': return 'bg-amber-100 dark:bg-amber-900/30 text-amber-600 dark:text-amber-400';
    case 'fail': return 'bg-red-100 dark:bg-red-900/30 text-red-600 dark:text-red-400';
    case 'info': return 'bg-blue-100 dark:bg-blue-900/30 text-blue-600 dark:text-blue-400';
  }
};

export const getCheckSeverityColor = (severity: CheckSeverity) => {
  switch (severity) {
    case 'critical': return 'bg-red-100 dark:bg-red-900/30 text-red-600 dark:text-red-400';
    case 'high': return 'bg-orange-100 dark:bg-orange-900/30 text-orange-600 dark:text-orange-400';
    case 'medium': return 'bg-yellow-100 dark:bg-yellow-900/30 text-yellow-600 dark:text-yellow-400';
    case 'low': return 'bg-blue-100 dark:bg-blue-900/30 text-blue-600 dark:text-blue-400';
  }
};

export const getSeverityColor = (severity: 'error' | 'warning' | 'info') => {
  switch (severity) {
    case 'error': return 'bg-red-50 dark:bg-red-900/20 border-red-200 dark:border-red-800 text-red-700 dark:text-red-300';
    case 'warning': return 'bg-amber-50 dark:bg-amber-900/20 border-amber-200 dark:border-amber-800 text-amber-700 dark:text-amber-300';
    case 'info': return 'bg-blue-50 dark:bg-blue-900/20 border-blue-200 dark:border-blue-800 text-blue-700 dark:text-blue-300';
  }
};

export const getSeverityIcon = (severity: 'error' | 'warning' | 'info') => {
  switch (severity) {
    case 'error': return 'error';
    case 'warning': return 'warning';
    case 'info': return 'info';
  }
};

export const groupByCategory = (issues: IntegrityIssue[]) => {
  return issues.reduce((acc, issue) => {
    if (!acc[issue.category]) acc[issue.category] = [];
    acc[issue.category].push(issue);
    return acc;
  }, {} as Record<string, IntegrityIssue[]>);
};

export const getCategoryLabel = (category: string) => {
  switch (category) {
    case 'orphan_record': return 'Orphan Records';
    case 'missing_relationship': return 'Missing Relationships';
    case 'sync_mismatch': return 'Sync Mismatches';
    case 'data_quality': return 'Data Quality';
    case 'billing_issue': return 'Billing Issues';
    case 'booking_issue': return 'Booking Issues';
    case 'system_error': return 'System Errors';
    default: return category;
  }
};

export const formatContextString = (context?: IssueContext): string | null => {
  if (!context) return null;
  
  const parts: string[] = [];
  
  if (context.memberName) parts.push(context.memberName);
  if (context.guestName && !context.memberName) parts.push(context.guestName);
  if (context.memberEmail) parts.push(context.memberEmail);
  if (context.memberTier) parts.push(`Tier: ${context.memberTier}`);
  if (context.billingProvider && context.billingProvider !== 'none') parts.push(`Provider: ${context.billingProvider}`);
  if (context.stripeCustomerId) parts.push(context.stripeCustomerId === 'none' ? 'No Stripe Customer' : `Customer: ${context.stripeCustomerId}`);
  if (context.stripeSubscriptionId) parts.push(context.stripeSubscriptionId === 'none' ? 'No Subscription' : `Sub: ${context.stripeSubscriptionId}`);
  if (context.memberStatus) parts.push(`Status: ${context.memberStatus}`);
  if (context.lastUpdate) {
    try {
      const formatted = new Date(context.lastUpdate).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'America/Los_Angeles' });
      parts.push(`Last updated: ${formatted}`);
    } catch {
      parts.push(`Last updated: ${context.lastUpdate}`);
    }
  }
  
  if (context.bookingDate || context.tourDate || context.classDate || context.eventDate) {
    const date = context.bookingDate || context.tourDate || context.classDate || context.eventDate;
    if (date) {
      try {
        const formatted = new Date(date).toLocaleDateString('en-US', { 
          month: 'short', 
          day: 'numeric', 
          year: 'numeric',
          timeZone: 'America/Los_Angeles'
        });
        parts.push(formatted);
      } catch {
        parts.push(date);
      }
    }
  }
  
  if (context.startTime) {
    const timeStr = context.startTime.substring(0, 5);
    parts.push(timeStr);
  }
  
  if (context.resourceName) parts.push(context.resourceName);
  if (context.className && !context.eventTitle) parts.push(context.className);
  if (context.eventTitle) parts.push(context.eventTitle);
  if (context.instructor) parts.push(`Instructor: ${context.instructor}`);
  
  return parts.length > 0 ? parts.join(' • ') : null;
};

export const getResultStyle = (result: { success: boolean; dryRun?: boolean } | null) => {
  if (!result) return '';
  if (!result.success) return 'bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-700';
  if (result.dryRun) return 'bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-700';
  return 'bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-700';
};

export const getTextStyle = (result: { success: boolean; dryRun?: boolean } | null) => {
  if (!result) return '';
  if (!result.success) return 'text-red-700 dark:text-red-400';
  if (result.dryRun) return 'text-blue-700 dark:text-blue-400';
  return 'text-green-700 dark:text-green-400';
};
