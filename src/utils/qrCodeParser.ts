export interface QrParseResult {
  type: 'member' | 'booking' | 'unknown';
  memberId?: string;
  bookingId?: number;
}

export function parseQrCode(rawText: string): QrParseResult {
  const decodedText = rawText.trim();
  if (!decodedText) return { type: 'unknown' };

  const memberMatch = decodedText.match(/^MEMBER:(.+)$/);
  if (memberMatch) {
    return { type: 'member', memberId: memberMatch[1] };
  }

  const bookingMatch = decodedText.match(/^BOOKING:(\d+)$/);
  if (bookingMatch) {
    return { type: 'booking', bookingId: Number(bookingMatch[1]) };
  }

  try {
    const url = new URL(decodedText);
    const memberId = url.searchParams.get('memberId');
    if (memberId) {
      return { type: 'member', memberId };
    }
    const bookingId = url.searchParams.get('bookingId');
    if (bookingId && /^\d+$/.test(bookingId)) {
      return { type: 'booking', bookingId: Number(bookingId) };
    }
  } catch {
    // Not a URL
  }

  try {
    const scanData = JSON.parse(decodedText);
    if (scanData.memberId) {
      return { type: 'member', memberId: String(scanData.memberId) };
    }
    if (scanData.bookingId != null) {
      const id = Number(scanData.bookingId);
      if (Number.isFinite(id) && id > 0) {
        return { type: 'booking', bookingId: id };
      }
    }
  } catch {
    // Not JSON
  }

  return { type: 'unknown' };
}
