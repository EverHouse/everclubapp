/**
 * Normalizes an email address for consistent storage and comparison.
 * - Converts to lowercase
 * - Trims whitespace
 * - Returns empty string for null/undefined inputs
 */
export function normalizeEmail(email: string | null | undefined): string {
  if (!email) return '';
  return email.toLowerCase().trim();
}

/**
 * Compares two email addresses case-insensitively.
 * Returns true if they match (ignoring case and whitespace).
 */
export function emailsMatch(email1: string | null | undefined, email2: string | null | undefined): boolean {
  return normalizeEmail(email1) === normalizeEmail(email2);
}
