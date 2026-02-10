import type { IntegrityCheckResult, IntegrityIssue, ActiveIssue, HistoryData } from './dataIntegrityTypes';
import { getCheckMetadata } from '../../../../data/integrityCheckMetadata';

export const formatTimeAgo = (date: Date | string) => {
  const now = new Date();
  const then = new Date(date);
  const diffMs = now.getTime() - then.getTime();
  const diffMins = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMs / 3600000);
  const diffDays = Math.floor(diffMs / 86400000);

  if (diffMins < 1) return 'just now';
  if (diffMins < 60) return `${diffMins} minute${diffMins === 1 ? '' : 's'} ago`;
  if (diffHours < 24) return `${diffHours} hour${diffHours === 1 ? '' : 's'} ago`;
  return `${diffDays} day${diffDays === 1 ? '' : 's'} ago`;
};

export const getIssueTracking = (issue: IntegrityIssue, historyData: HistoryData | undefined): ActiveIssue | undefined => {
  if (!historyData) return undefined;
  const issueKey = `${issue.table}_${issue.recordId}`;
  return historyData.activeIssues.find(ai => ai.issueKey === issueKey);
};

export const getTrendIcon = (trend: 'increasing' | 'decreasing' | 'stable') => {
  switch (trend) {
    case 'increasing': return 'trending_up';
    case 'decreasing': return 'trending_down';
    case 'stable': return 'trending_flat';
  }
};

export const getTrendColor = (trend: 'increasing' | 'decreasing' | 'stable') => {
  switch (trend) {
    case 'increasing': return 'text-red-500 dark:text-red-400';
    case 'decreasing': return 'text-green-500 dark:text-green-400';
    case 'stable': return 'text-gray-500 dark:text-gray-400';
  }
};

export const escapeCSVField = (field: string | number): string => {
  const str = String(field);
  if (str.includes(',') || str.includes('"') || str.includes('\n')) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
};

export const downloadCSV = (results: IntegrityCheckResult[]) => {
  const headers = ['Check Name', 'Severity', 'Category', 'Table', 'Record ID', 'Description', 'Suggestion'];
  const rows: string[][] = [];

  results.forEach(result => {
    const metadata = getCheckMetadata(result.checkName);
    const displayTitle = metadata?.title || result.checkName;

    result.issues.forEach(issue => {
      rows.push([
        displayTitle,
        issue.severity,
        issue.category,
        issue.table,
        String(issue.recordId),
        issue.description,
        issue.suggestion || ''
      ]);
    });
  });

  const csvContent = [
    headers.map(escapeCSVField).join(','),
    ...rows.map(row => row.map(escapeCSVField).join(','))
  ].join('\n');

  const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  const date = new Date().toISOString().split('T')[0];
  link.href = url;
  link.download = `data-integrity-export-${date}.csv`;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
};
