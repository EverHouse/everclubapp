export function getStatusColor(status: string, isDark: boolean): string {
  switch (status?.toLowerCase()) {
    case 'pending':
    case 'pending_approval':
      return isDark ? 'bg-yellow-500/20 text-yellow-300' : 'bg-yellow-500/20 text-yellow-700';
    case 'approved':
    case 'confirmed':
      return isDark ? 'bg-green-500/20 text-green-300' : 'bg-green-500/20 text-green-700';
    case 'attended':
    case 'checked_in':
      return isDark ? 'bg-blue-500/20 text-blue-300' : 'bg-blue-500/20 text-blue-700';
    case 'declined':
      return isDark ? 'bg-red-500/20 text-red-300' : 'bg-red-500/20 text-red-700';
    case 'no_show':
      return isDark ? 'bg-orange-500/20 text-orange-300' : 'bg-orange-500/20 text-orange-700';
    case 'cancellation_pending':
      return isDark ? 'bg-orange-500/20 text-orange-300' : 'bg-orange-500/20 text-orange-700';
    case 'cancelled':
      return isDark ? 'bg-gray-500/20 text-gray-400' : 'bg-gray-500/20 text-gray-500';
    case 'expired':
      return isDark ? 'bg-gray-500/20 text-gray-400' : 'bg-gray-500/20 text-gray-500';
    default:
      return isDark ? 'bg-gray-500/20 text-gray-400' : 'bg-gray-500/20 text-gray-500';
  }
}

export function getStatusBadge(status: string): string {
  switch (status?.toLowerCase()) {
    case 'pending':
    case 'pending_approval':
      return 'bg-yellow-100 text-yellow-700 dark:bg-yellow-500/20 dark:text-yellow-300';
    case 'approved':
    case 'confirmed':
    case 'attended':
    case 'checked_in':
      return 'bg-green-100 text-green-700 dark:bg-green-500/20 dark:text-green-300';
    case 'no_show':
    case 'declined':
    case 'cancelled':
      return 'bg-red-100 text-red-700 dark:bg-red-500/20 dark:text-red-300';
    case 'cancellation_pending':
      return 'bg-orange-100 text-orange-700 dark:bg-orange-500/20 dark:text-orange-300';
    case 'expired':
      return 'bg-gray-100 text-gray-600 dark:bg-white/10 dark:text-gray-400';
    default:
      return 'bg-gray-100 text-gray-600 dark:bg-white/10 dark:text-gray-400';
  }
}

export function getInquiryStatusColor(status: string): string {
  switch (status?.toLowerCase()) {
    case 'new':
      return 'bg-blue-100 text-blue-700 dark:bg-blue-500/20 dark:text-blue-300';
    case 'read':
      return 'bg-purple-100 text-purple-700 dark:bg-purple-500/20 dark:text-purple-300';
    case 'in_progress':
      return 'bg-yellow-100 text-yellow-700 dark:bg-yellow-500/20 dark:text-yellow-300';
    case 'replied':
      return 'bg-teal-100 text-teal-700 dark:bg-teal-500/20 dark:text-teal-300';
    case 'resolved':
      return 'bg-green-100 text-green-700 dark:bg-green-500/20 dark:text-green-300';
    case 'closed':
    case 'archived':
      return 'bg-gray-100 text-gray-600 dark:bg-white/10 dark:text-gray-400';
    default:
      return 'bg-gray-100 text-gray-600 dark:bg-white/10 dark:text-gray-400';
  }
}

export function getBugReportStatusColor(status: string): string {
  switch (status?.toLowerCase()) {
    case 'open':
      return 'bg-red-100 text-red-700 dark:bg-red-500/20 dark:text-red-300';
    case 'in_progress':
      return 'bg-yellow-100 text-yellow-700 dark:bg-yellow-500/20 dark:text-yellow-300';
    case 'resolved':
      return 'bg-green-100 text-green-700 dark:bg-green-500/20 dark:text-green-300';
    case 'wont_fix':
      return 'bg-gray-100 text-gray-600 dark:bg-white/10 dark:text-gray-400';
    default:
      return 'bg-gray-100 text-gray-600 dark:bg-white/10 dark:text-gray-400';
  }
}

export function formatStatusLabel(status: string): string {
  if (!status || typeof status !== 'string') return '';
  switch (status.toLowerCase()) {
    case 'pending_approval':
      return 'Pending Approval';
    case 'no_show':
      return 'No Show';
    case 'checked_in':
      return 'Checked In';
    case 'cancellation_pending':
      return 'Cancellation Pending';
    case 'in_progress':
      return 'In Progress';
    case 'wont_fix':
      return "Won't Fix";
    default:
      return status.charAt(0).toUpperCase() + status.slice(1).toLowerCase();
  }
}

type MemberStatusSeverity = 'error' | 'warning' | 'info' | 'success' | 'neutral';

interface MemberStatusInfo {
  severity: MemberStatusSeverity;
  label: string;
  colorClass: { dark: string; light: string };
}

const STATUS_MAP: Record<string, MemberStatusInfo> = {
  // Error severity (red) - membership ended or blocked
  expired: { severity: 'error', label: 'Expired', colorClass: { dark: 'bg-red-500/20 text-red-300', light: 'bg-red-500/20 text-red-700' } },
  terminated: { severity: 'error', label: 'Terminated', colorClass: { dark: 'bg-red-500/20 text-red-300', light: 'bg-red-500/20 text-red-700' } },
  inactive: { severity: 'error', label: 'Inactive', colorClass: { dark: 'bg-red-500/20 text-red-300', light: 'bg-red-500/20 text-red-700' } },
  delinquent: { severity: 'error', label: 'Delinquent', colorClass: { dark: 'bg-red-500/20 text-red-300', light: 'bg-red-500/20 text-red-700' } },
  blacklisted: { severity: 'error', label: 'Blacklisted', colorClass: { dark: 'bg-red-500/20 text-red-300', light: 'bg-red-500/20 text-red-700' } },
  lapsed: { severity: 'error', label: 'Lapsed', colorClass: { dark: 'bg-red-500/20 text-red-300', light: 'bg-red-500/20 text-red-700' } },
  cancelled: { severity: 'error', label: 'Cancelled', colorClass: { dark: 'bg-red-500/20 text-red-300', light: 'bg-red-500/20 text-red-700' } },
  revoked: { severity: 'error', label: 'Revoked', colorClass: { dark: 'bg-red-500/20 text-red-300', light: 'bg-red-500/20 text-red-700' } },
  collections: { severity: 'error', label: 'Collections', colorClass: { dark: 'bg-red-500/20 text-red-300', light: 'bg-red-500/20 text-red-700' } },
  collections_hold: { severity: 'error', label: 'Collections Hold', colorClass: { dark: 'bg-red-500/20 text-red-300', light: 'bg-red-500/20 text-red-700' } },
  banned: { severity: 'error', label: 'Banned', colorClass: { dark: 'bg-red-500/20 text-red-300', light: 'bg-red-500/20 text-red-700' } },
  deactivated: { severity: 'error', label: 'Deactivated', colorClass: { dark: 'bg-red-500/20 text-red-300', light: 'bg-red-500/20 text-red-700' } },
  
  // Warning severity (orange) - temporary states needing attention
  paused: { severity: 'warning', label: 'Paused', colorClass: { dark: 'bg-orange-500/20 text-orange-300', light: 'bg-orange-500/20 text-orange-700' } },
  suspended: { severity: 'warning', label: 'Suspended', colorClass: { dark: 'bg-orange-500/20 text-orange-300', light: 'bg-orange-500/20 text-orange-700' } },
  probation: { severity: 'warning', label: 'Probation', colorClass: { dark: 'bg-orange-500/20 text-orange-300', light: 'bg-orange-500/20 text-orange-700' } },
  grace_period: { severity: 'warning', label: 'Grace Period', colorClass: { dark: 'bg-orange-500/20 text-orange-300', light: 'bg-orange-500/20 text-orange-700' } },
  grace_hold: { severity: 'warning', label: 'Grace Hold', colorClass: { dark: 'bg-orange-500/20 text-orange-300', light: 'bg-orange-500/20 text-orange-700' } },
  grace_review: { severity: 'warning', label: 'Grace Review', colorClass: { dark: 'bg-orange-500/20 text-orange-300', light: 'bg-orange-500/20 text-orange-700' } },
  on_hold: { severity: 'warning', label: 'On Hold', colorClass: { dark: 'bg-orange-500/20 text-orange-300', light: 'bg-orange-500/20 text-orange-700' } },
  overdue: { severity: 'warning', label: 'Overdue', colorClass: { dark: 'bg-orange-500/20 text-orange-300', light: 'bg-orange-500/20 text-orange-700' } },
  past_due: { severity: 'warning', label: 'Past Due', colorClass: { dark: 'bg-orange-500/20 text-orange-300', light: 'bg-orange-500/20 text-orange-700' } },
  frozen: { severity: 'warning', label: 'Frozen', colorClass: { dark: 'bg-orange-500/20 text-orange-300', light: 'bg-orange-500/20 text-orange-700' } },
  review: { severity: 'warning', label: 'Under Review', colorClass: { dark: 'bg-orange-500/20 text-orange-300', light: 'bg-orange-500/20 text-orange-700' } },
  
  // Info severity (yellow) - in process
  pending: { severity: 'info', label: 'Pending', colorClass: { dark: 'bg-yellow-500/20 text-yellow-300', light: 'bg-yellow-500/20 text-yellow-700' } },
  pending_approval: { severity: 'info', label: 'Pending Approval', colorClass: { dark: 'bg-yellow-500/20 text-yellow-300', light: 'bg-yellow-500/20 text-yellow-700' } },
  pending_payment: { severity: 'info', label: 'Pending Payment', colorClass: { dark: 'bg-yellow-500/20 text-yellow-300', light: 'bg-yellow-500/20 text-yellow-700' } },
  pending_review: { severity: 'info', label: 'Pending Review', colorClass: { dark: 'bg-yellow-500/20 text-yellow-300', light: 'bg-yellow-500/20 text-yellow-700' } },
  trial: { severity: 'info', label: 'Trial', colorClass: { dark: 'bg-yellow-500/20 text-yellow-300', light: 'bg-yellow-500/20 text-yellow-700' } },
  provisional: { severity: 'info', label: 'Provisional', colorClass: { dark: 'bg-yellow-500/20 text-yellow-300', light: 'bg-yellow-500/20 text-yellow-700' } },
  pending_docs: { severity: 'info', label: 'Pending Docs', colorClass: { dark: 'bg-yellow-500/20 text-yellow-300', light: 'bg-yellow-500/20 text-yellow-700' } },
  awaiting_payment: { severity: 'info', label: 'Awaiting Payment', colorClass: { dark: 'bg-yellow-500/20 text-yellow-300', light: 'bg-yellow-500/20 text-yellow-700' } },
  
  // Info severity (blue) - trialing
  trialing: { severity: 'info', label: 'Trialing', colorClass: { dark: 'bg-blue-500/20 text-blue-300', light: 'bg-blue-500/20 text-blue-700' } },
  
  // Success severity (green) - active
  active: { severity: 'success', label: 'Active', colorClass: { dark: 'bg-green-500/20 text-green-300', light: 'bg-green-500/20 text-green-700' } },
  current: { severity: 'success', label: 'Current', colorClass: { dark: 'bg-green-500/20 text-green-300', light: 'bg-green-500/20 text-green-700' } },
  
  // Neutral (blue/gray) - informational states
  former_member: { severity: 'neutral', label: 'Former Member', colorClass: { dark: 'bg-blue-500/20 text-blue-300', light: 'bg-blue-500/20 text-blue-700' } },
  former: { severity: 'neutral', label: 'Former Member', colorClass: { dark: 'bg-blue-500/20 text-blue-300', light: 'bg-blue-500/20 text-blue-700' } },
  alumni: { severity: 'neutral', label: 'Alumni', colorClass: { dark: 'bg-blue-500/20 text-blue-300', light: 'bg-blue-500/20 text-blue-700' } },
  honorary: { severity: 'neutral', label: 'Honorary', colorClass: { dark: 'bg-blue-500/20 text-blue-300', light: 'bg-blue-500/20 text-blue-700' } },
  legacy: { severity: 'neutral', label: 'Legacy', colorClass: { dark: 'bg-blue-500/20 text-blue-300', light: 'bg-blue-500/20 text-blue-700' } },
  lifetime: { severity: 'neutral', label: 'Lifetime', colorClass: { dark: 'bg-blue-500/20 text-blue-300', light: 'bg-blue-500/20 text-blue-700' } },
};

const DEFAULT_STATUS_INFO: MemberStatusInfo = {
  severity: 'neutral',
  label: 'Unknown',
  colorClass: { dark: 'bg-gray-500/20 text-gray-400', light: 'bg-gray-500/20 text-gray-500' }
};

function getMemberStatusInfo(status: string | undefined | null): MemberStatusInfo {
  if (!status || typeof status !== 'string') return DEFAULT_STATUS_INFO;
  const s = status.toLowerCase();
  return STATUS_MAP[s] || { ...DEFAULT_STATUS_INFO, label: status.replace(/_/g, ' ') };
}

export function getMemberStatusBadgeClass(status: string | undefined | null): string {
  if (!status || typeof status !== 'string') {
    return 'bg-gray-500/20 text-gray-500 dark:bg-gray-500/20 dark:text-gray-400';
  }
  const info = getMemberStatusInfo(status);
  const darkClasses = info.colorClass.dark.split(' ').map((c: string) => `dark:${c}`).join(' ');
  return `${info.colorClass.light} ${darkClasses}`;
}

export function getMemberStatusColor(status: string | undefined | null, isDark: boolean): string {
  const info = getMemberStatusInfo(status);
  return isDark ? info.colorClass.dark : info.colorClass.light;
}

export function getMemberStatusLabel(status: string | undefined | null): string {
  return getMemberStatusInfo(status).label;
}

export function getSubscriptionStatusBadge(status: string): string {
  switch (status?.toLowerCase()) {
    case 'active':
      return 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400';
    case 'past_due':
      return 'bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400';
    case 'canceled':
      return 'bg-gray-100 text-gray-800 dark:bg-gray-700/30 dark:text-gray-400';
    case 'trialing':
      return 'bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-400';
    case 'paused':
      return 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-400';
    case 'unpaid':
      return 'bg-orange-100 text-orange-800 dark:bg-orange-900/30 dark:text-orange-400';
    default:
      return 'bg-gray-100 text-gray-600 dark:bg-gray-700/30 dark:text-gray-400';
  }
}

export function getInvoiceStatusBadge(status: string): string {
  switch (status?.toLowerCase()) {
    case 'paid':
      return 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400';
    case 'open':
      return 'bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-400';
    case 'uncollectible':
      return 'bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400';
    case 'void':
      return 'bg-gray-100 text-gray-800 dark:bg-gray-700/30 dark:text-gray-400';
    case 'draft':
      return 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-400';
    default:
      return 'bg-gray-100 text-gray-600 dark:bg-gray-700/30 dark:text-gray-400';
  }
}

export function getBillingStatusBadge(status: string, isDark: boolean): string {
  const styles: Record<string, { dark: string; light: string }> = {
    active: { dark: 'bg-green-500/20 text-green-400', light: 'bg-green-100 text-green-700' },
    paused: { dark: 'bg-yellow-500/20 text-yellow-400', light: 'bg-yellow-100 text-yellow-700' },
    canceled: { dark: 'bg-red-500/20 text-red-400', light: 'bg-red-100 text-red-700' },
    past_due: { dark: 'bg-orange-500/20 text-orange-400', light: 'bg-orange-100 text-orange-700' },
    trialing: { dark: 'bg-blue-500/20 text-blue-400', light: 'bg-blue-100 text-blue-700' },
    paid: { dark: 'bg-green-500/20 text-green-400', light: 'bg-green-100 text-green-700' },
    open: { dark: 'bg-yellow-500/20 text-yellow-400', light: 'bg-yellow-100 text-yellow-700' },
    draft: { dark: 'bg-gray-500/20 text-gray-400', light: 'bg-gray-100 text-gray-600' },
    uncollectible: { dark: 'bg-red-500/20 text-red-400', light: 'bg-red-100 text-red-700' },
  };
  const style = styles[status?.toLowerCase()];
  if (style) return isDark ? style.dark : style.light;
  return isDark ? 'bg-gray-500/20 text-gray-400' : 'bg-gray-100 text-gray-600';
}

export function getRoleColor(role: string | null): string {
  switch (role?.toLowerCase()) {
    case 'admin':
      return 'bg-purple-100 dark:bg-purple-900/30 text-purple-700 dark:text-purple-400';
    case 'staff':
      return 'bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-400';
    default:
      return 'bg-gray-100 dark:bg-white/10 text-gray-600 dark:text-gray-400';
  }
}
