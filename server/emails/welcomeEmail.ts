import { getResendClient } from '../utils/resend';
import { getErrorMessage } from '../utils/errorUtils';
import { logger } from '../core/logger';
import { isEmailCategoryEnabled } from '../core/settingsHelper';
import { emailLayout, CLUB_COLORS } from './emailLayout';

export function getWelcomeEmailHtml(firstName?: string): string {
  const greeting = firstName ? `Welcome, ${firstName}!` : 'Welcome to Ever Club!';

  return emailLayout(`
                <tr>
                  <td style="text-align: center; padding-bottom: 16px;">
                    <h1 style="margin: 0; font-family: 'Newsreader', Georgia, serif; font-size: 32px; font-weight: 400; color: ${CLUB_COLORS.deepGreen};">
                      ${greeting}
                    </h1>
                  </td>
                </tr>

                <tr>
                  <td style="text-align: center; padding-bottom: 40px;">
                    <p style="margin: 0; font-size: 16px; color: ${CLUB_COLORS.textMuted}; line-height: 1.6;">
                      Your private club experience is now in your pocket. Here's what you can do.
                    </p>
                  </td>
                </tr>

                <tr>
                  <td style="padding-bottom: 32px;">
                    <p style="margin: 0; font-size: 14px; color: ${CLUB_COLORS.textMuted}; line-height: 1.6;">
                      Here are 3 ways to get the most out of your membership:
                    </p>
                  </td>
                </tr>

                <tr>
                  <td style="padding-bottom: 28px; border-bottom: 1px solid ${CLUB_COLORS.borderLight};">
                    <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%">
                      <tr>
                        <td width="48" valign="top" style="padding-right: 16px;">
                          <div style="width: 40px; height: 40px; background-color: ${CLUB_COLORS.bone}; border-radius: 10px; text-align: center; line-height: 40px;">
                            <span style="font-size: 20px;">⛳</span>
                          </div>
                        </td>
                        <td valign="top">
                          <h3 style="margin: 0 0 8px 0; font-size: 18px; font-weight: 600; color: ${CLUB_COLORS.textDark};">
                            Book Golf Simulators
                          </h3>
                          <p style="margin: 0 0 12px 0; font-size: 14px; color: ${CLUB_COLORS.textMuted}; line-height: 1.6;">
                            Reserve your Trackman bay in just a few taps. See real-time availability, request your preferred time, and get instant confirmation.
                          </p>
                          <a href="https://everclub.app/book-golf" style="display: inline-block; font-size: 14px; color: ${CLUB_COLORS.deepGreen}; text-decoration: none; font-weight: 500;">
                            Book now →
                          </a>
                        </td>
                      </tr>
                    </table>
                  </td>
                </tr>

                <tr>
                  <td style="padding: 28px 0; border-bottom: 1px solid ${CLUB_COLORS.borderLight};">
                    <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%">
                      <tr>
                        <td width="48" valign="top" style="padding-right: 16px;">
                          <div style="width: 40px; height: 40px; background-color: ${CLUB_COLORS.bone}; border-radius: 10px; text-align: center; line-height: 40px;">
                            <span style="font-size: 20px;">🧘</span>
                          </div>
                        </td>
                        <td valign="top">
                          <h3 style="margin: 0 0 8px 0; font-size: 18px; font-weight: 600; color: ${CLUB_COLORS.textDark};">
                            Explore Wellness
                          </h3>
                          <p style="margin: 0 0 12px 0; font-size: 14px; color: ${CLUB_COLORS.textMuted}; line-height: 1.6;">
                            Browse spa services, fitness classes, and wellness treatments. Sign up for classes directly from the app with one-tap enrollment.
                          </p>
                          <a href="https://everclub.app/wellness" style="display: inline-block; font-size: 14px; color: ${CLUB_COLORS.deepGreen}; text-decoration: none; font-weight: 500;">
                            View wellness →
                          </a>
                        </td>
                      </tr>
                    </table>
                  </td>
                </tr>

                <tr>
                  <td style="padding-top: 28px; padding-bottom: 40px;">
                    <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%">
                      <tr>
                        <td width="48" valign="top" style="padding-right: 16px;">
                          <div style="width: 40px; height: 40px; background-color: ${CLUB_COLORS.bone}; border-radius: 10px; text-align: center; line-height: 40px;">
                            <span style="font-size: 20px;">🎉</span>
                          </div>
                        </td>
                        <td valign="top">
                          <h3 style="margin: 0 0 8px 0; font-size: 18px; font-weight: 600; color: ${CLUB_COLORS.textDark};">
                            Join Events
                          </h3>
                          <p style="margin: 0 0 12px 0; font-size: 14px; color: ${CLUB_COLORS.textMuted}; line-height: 1.6;">
                            Stay in the loop on member gatherings, workshops, and special occasions. RSVP with one tap and add events to your calendar.
                          </p>
                          <a href="https://everclub.app/events" style="display: inline-block; font-size: 14px; color: ${CLUB_COLORS.deepGreen}; text-decoration: none; font-weight: 500;">
                            See events →
                          </a>
                        </td>
                      </tr>
                    </table>
                  </td>
                </tr>

                <tr>
                  <td style="text-align: center; padding-bottom: 32px;">
                    <a href="https://everclub.app" style="display: inline-block; background-color: ${CLUB_COLORS.deepGreen}; color: #ffffff; font-size: 16px; font-weight: 500; text-decoration: none; padding: 14px 32px; border-radius: 12px;">
                      Open Ever Club App
                    </a>
                  </td>
                </tr>
  `);
}

export async function sendWelcomeEmail(email: string, firstName?: string): Promise<{ success: boolean; error?: string }> {
  try {
    if (!await isEmailCategoryEnabled('welcome')) {
      logger.info('[Welcome Email] SKIPPED - welcome emails disabled via settings', { extra: { email } });
      return { success: true };
    }
    const { client, fromEmail } = await getResendClient();

    await client.emails.send({
      from: fromEmail || 'Ever Club <noreply@everclub.app>',
      to: email,
      subject: 'Welcome to Ever Club',
      html: getWelcomeEmailHtml(firstName)
    });

    logger.info(`[Welcome Email] Sent successfully to ${email}`);
    return { success: true };
  } catch (error: unknown) {
    logger.error(`[Welcome Email] Failed to send to ${email}: ${getErrorMessage(error)}`, { error: error as Error });
    return { success: false, error: getErrorMessage(error) };
  }
}
