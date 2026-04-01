function formatSingleArea(area: string): string {
  const trimmed = area.trim();
  if (trimmed === 'entire_facility') return 'Entire Facility';
  if (trimmed === 'all_bays') return 'All Simulator Bays';
  if (trimmed === 'conference_room' || trimmed === 'Conference Room') return 'Conference Room';
  if (trimmed === 'none') return '';
  if (trimmed.startsWith('bay_')) {
    const bayNum = trimmed.replace('bay_', '');
    return `Simulator Bay ${bayNum}`;
  }
  return trimmed;
}

export function formatAffectedAreasForNotification(areas: string | null | undefined): string {
  if (!areas) return '';
  const trimmed = areas.trim();
  if (trimmed === 'none' || trimmed === '') return '';
  if (trimmed === 'entire_facility') return 'Entire Facility';
  if (trimmed === 'all_bays') return 'All Simulator Bays';

  if (trimmed.startsWith('[') && trimmed.endsWith(']')) {
    try {
      const parsed = JSON.parse(trimmed);
      if (Array.isArray(parsed)) {
        return parsed.map((a: string) => formatSingleArea(String(a))).filter(a => a).join(', ');
      }
    } catch { /* fall through to comma-separated parsing */ }
  }

  return trimmed.split(',').map(a => formatSingleArea(a)).filter(a => a).join(', ');
}
