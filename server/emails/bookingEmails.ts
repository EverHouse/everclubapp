import { getResendClient } from '../utils/resend';
import { logger } from '../core/logger';
import { isEmailCategoryEnabled, getSettingValue } from '../core/settingsHelper';
import { emailLayout, CLUB_COLORS } from './emailLayout';
import { getErrorMessage } from '../utils/errorUtils';

interface BookingConfirmationData {
  date: string;
  time: string;
  bayName: string;
  memberName: string;
  durationMinutes?: number;
  addressLine1?: string;
  cityStateZip?: string;
  bookingId?: number;
  walletPassEnabled?: boolean;
}

export function getBookingConfirmationHtml(data: BookingConfirmationData): string {
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
                Booking Confirmed
              </h1>
            </td>
          </tr>
          <tr>
            <td style="text-align: center; padding-bottom: 24px;">
              <div style="width: 64px; height: 64px; background-color: #22c55e; border-radius: 50%; margin: 0 auto; line-height: 64px;">
                <span style="font-size: 32px; color: #ffffff;">&#10003;</span>
              </div>
            </td>
          </tr>
          <tr>
            <td style="text-align: center; padding-bottom: 32px;">
              <p style="margin: 0; font-size: 16px; color: ${CLUB_COLORS.textMuted}; line-height: 1.6;">
                Hi ${data.memberName}, your simulator booking is confirmed!
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
                          <p style="margin: 4px 0 0 0; font-size: 18px; font-weight: 600; color: ${CLUB_COLORS.textDark};">${data.bayName}</p>
                        </td>
                      </tr>
                    </table>
                  </td>
                </tr>
              </table>
            </td>
          </tr>
          <tr>
            <td style="text-align: center; padding-bottom: ${data.bookingId && data.walletPassEnabled ? '16px' : '32px'};">
              <a href="https://everclub.app/bookings" style="display: inline-block; background-color: ${CLUB_COLORS.deepGreen}; color: #ffffff; font-size: 16px; font-weight: 600; text-decoration: none; padding: 14px 32px; border-radius: 8px;">
                View My Bookings
              </a>
            </td>
          </tr>
          ${data.bookingId && data.walletPassEnabled ? `
          <tr>
            <td style="text-align: center; padding-bottom: 32px;">
              <a href="https://everclub.app/api/member/booking-wallet-pass/${data.bookingId}" style="display: inline-block; background-color: #000000; color: #ffffff; font-size: 14px; font-weight: 600; text-decoration: none; padding: 12px 24px; border-radius: 8px;">
                &#63743; Add to Apple Wallet
              </a>
            </td>
          </tr>
          ` : ''}
          <tr>
            <td style="text-align: center; border-top: 1px solid ${CLUB_COLORS.borderLight}; padding-top: 24px;">
              <p style="margin: 0; font-size: 12px; color: ${CLUB_COLORS.textMuted};">
                Need to make changes? You can reschedule or cancel from your bookings page.
              </p>
              <p style="margin: 16px 0 0 0; font-size: 12px; color: ${CLUB_COLORS.textMuted};">
                Ever Club &bull; ${data.addressLine1 || '15771 Red Hill Ave, Ste 500'} &bull; ${data.cityStateZip || 'Tustin, CA 92780'}
              </p>
            </td>
          </tr>
  `;

  return emailLayout(content);
}

export async function sendBookingConfirmationEmail(
  email: string,
  data: BookingConfirmationData
): Promise<boolean> {
  if (!await isEmailCategoryEnabled('booking')) {
    logger.info('[Booking Confirmation Email] SKIPPED - booking emails disabled via settings', { extra: { email } });
    return true;
  }
  try {
    const resendResult = await getResendClient();
    if (!resendResult) {
      logger.warn('[BookingEmails] Resend client not configured, skipping email');
      return false;
    }
    
    const addressLine1 = await getSettingValue('contact.address_line1', '15771 Red Hill Ave, Ste 500');
    const cityStateZip = await getSettingValue('contact.city_state_zip', 'Tustin, CA 92780');
    const html = getBookingConfirmationHtml({ ...data, addressLine1, cityStateZip });
    
    await resendResult.client.emails.send({
      from: resendResult.fromEmail,
      to: email,
      subject: `Booking Confirmed: ${data.bayName} on ${data.date}`,
      html,
    });
    
    logger.info('[BookingEmails] Sent booking confirmation email', { extra: { email, date: data.date } });
    return true;
  } catch (error: unknown) {
    logger.error('[BookingEmails] Failed to send booking confirmation', { extra: { error: getErrorMessage(error) } });
    return false;
  }
}
