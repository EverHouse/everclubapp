import { emailLayout, CLUB_COLORS, escapeHtml } from './emailLayout';

export interface TourConfirmationData {
  guestName: string;
  date: string;
  time: string;
  addressLine1: string;
  cityStateZip: string;
}

export function getTourConfirmationHtml(data: TourConfirmationData): string {
  const formattedDate = new Date(data.date + 'T12:00:00').toLocaleDateString('en-US', {
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    timeZone: 'America/Los_Angeles',
  });

  const formattedTime = data.time.length === 5
    ? new Date(`2000-01-01T${data.time}`).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true, timeZone: 'America/Los_Angeles' })
    : data.time;

  const content = `
          <tr>
            <td style="text-align: center; padding-bottom: 16px;">
              <h1 style="margin: 0; font-family: 'Newsreader', Georgia, serif; font-size: 28px; font-weight: 400; color: ${CLUB_COLORS.deepGreen};">
                Tour Confirmed
              </h1>
            </td>
          </tr>
          <tr>
            <td style="text-align: center; padding-bottom: 24px;">
              <div style="width: 64px; height: 64px; background-color: ${CLUB_COLORS.lavender}; border-radius: 50%; margin: 0 auto; line-height: 64px;">
                <span style="font-size: 32px; color: ${CLUB_COLORS.deepGreen};">&#10003;</span>
              </div>
            </td>
          </tr>
          <tr>
            <td style="text-align: center; padding-bottom: 32px;">
              <p style="margin: 0; font-size: 16px; color: ${CLUB_COLORS.textMuted}; line-height: 1.6;">
                Hi ${escapeHtml(data.guestName)}, your tour at Ever Club is confirmed!
              </p>
            </td>
          </tr>
          <tr>
            <td style="padding-bottom: 32px;">
              <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%" style="background-color: ${CLUB_COLORS.bone}; border-radius: 12px;">
                <tr>
                  <td style="padding: 24px;">
                    <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%">
                      <tr>
                        <td style="padding-bottom: 16px;">
                          <p style="margin: 0; font-size: 12px; text-transform: uppercase; letter-spacing: 0.5px; color: ${CLUB_COLORS.textMuted};">Date</p>
                          <p style="margin: 4px 0 0 0; font-size: 18px; font-weight: 600; color: ${CLUB_COLORS.textDark};">${formattedDate}</p>
                        </td>
                      </tr>
                      <tr>
                        <td style="padding-bottom: 16px;">
                          <p style="margin: 0; font-size: 12px; text-transform: uppercase; letter-spacing: 0.5px; color: ${CLUB_COLORS.textMuted};">Time</p>
                          <p style="margin: 4px 0 0 0; font-size: 18px; font-weight: 600; color: ${CLUB_COLORS.textDark};">${formattedTime}</p>
                        </td>
                      </tr>
                      <tr>
                        <td>
                          <p style="margin: 0; font-size: 12px; text-transform: uppercase; letter-spacing: 0.5px; color: ${CLUB_COLORS.textMuted};">Location</p>
                          <p style="margin: 4px 0 0 0; font-size: 18px; font-weight: 600; color: ${CLUB_COLORS.textDark};">Ever Club</p>
                          <p style="margin: 4px 0 0 0; font-size: 14px; color: ${CLUB_COLORS.textMuted};">${data.addressLine1}, ${data.cityStateZip}</p>
                        </td>
                      </tr>
                    </table>
                  </td>
                </tr>
              </table>
            </td>
          </tr>
          <tr>
            <td style="text-align: center; padding-bottom: 32px;">
              <p style="margin: 0; font-size: 14px; color: ${CLUB_COLORS.textMuted}; line-height: 1.6;">
                We look forward to showing you around. If you need to make changes, please contact us.
              </p>
            </td>
          </tr>
          <tr>
            <td style="text-align: center; border-top: 1px solid ${CLUB_COLORS.borderLight}; padding-top: 24px;">
              <p style="margin: 0; font-size: 12px; color: ${CLUB_COLORS.textMuted};">
                Ever Club &bull; ${data.addressLine1} &bull; ${data.cityStateZip}
              </p>
            </td>
          </tr>
  `;

  return emailLayout(content);
}
