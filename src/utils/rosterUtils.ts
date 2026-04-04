export function isPlaceholderGuestName(name: string | null | undefined): boolean {
  if (!name) return false;
  const normalized = name.trim().toLowerCase();
  return /^guest\s+\d+$/.test(normalized) ||
         /^guest\s*\(.*pending.*\)$/i.test(normalized) ||
         normalized === 'empty slot';
}
