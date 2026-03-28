import { getResendClient } from '../utils/resend';
import { getErrorMessage } from '../utils/errorUtils';
import { logger } from '../core/logger';
import { isEmailCategoryEnabled } from '../core/settingsHelper';
import { emailLayout, CLUB_COLORS } from './emailLayout';

export function getFirstVisitHtml(params: { firstName?: string }): string {
  const greeting = params.firstName ? `Welcome, ${params.firstName}!` : 'Welcome to Ever Club!';

  const content = `
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
                You're checked in! We're glad you're here for your first visit. Make yourself at home and explore everything Ever Club has to offer.
              </p>
            </td>
          </tr>
          
          <tr>
            <td style="padding-bottom: 32px;">
              <p style="margin: 0 0 16px 0; font-size: 18px; font-weight: 600; color: ${CLUB_COLORS.textDark};">
                Get the Most from Your Membership
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
                      Request your preferred Trackman bay time through the app. Check real-time availability and get confirmed in minutes.
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
                      <span style="font-size: 20px;">🎉</span>
                    </div>
                  </td>
                  <td valign="top">
                    <h3 style="margin: 0 0 8px 0; font-size: 18px; font-weight: 600; color: ${CLUB_COLORS.textDark};">
                      Browse Events
                    </h3>
                    <p style="margin: 0 0 12px 0; font-size: 14px; color: ${CLUB_COLORS.textMuted}; line-height: 1.6;">
                      View upcoming member events and RSVP with one tap. From workshops to social gatherings, there's always something happening.
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
            <td style="padding-top: 28px; padding-bottom: 40px;">
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
                      Browse spa services, fitness classes, and wellness treatments. Enroll directly from the app with one tap.
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
            <td style="text-align: center; padding-bottom: 32px;">
              <a href="https://everclub.app" style="display: inline-block; background-color: ${CLUB_COLORS.deepGreen}; color: #ffffff; font-size: 16px; font-weight: 500; text-decoration: none; padding: 14px 32px; border-radius: 12px;">
                Open Ever Club App
              </a>
            </td>
          </tr>
  `;

  return emailLayout(content);
}

export async function sendFirstVisitConfirmationEmail(
  email: string,
  params: { firstName?: string }
): Promise<{ success: boolean; error?: string }> {
  if (!await isEmailCategoryEnabled('welcome')) {
    logger.info('[First Visit Email] SKIPPED - welcome emails disabled via settings', { extra: { email } });
    return { success: true };
  }
  try {
    const { client, fromEmail } = await getResendClient();

    await client.emails.send({
      from: fromEmail || 'Ever Club <noreply@everclub.app>',
      to: email,
      subject: "You're All Checked In - Welcome to Ever Club!",
      html: getFirstVisitHtml(params)
    });

    logger.info(`[FirstVisitEmail] Sent first visit confirmation email to ${email}`);
    return { success: true };
  } catch (error: unknown) {
    logger.error(`[FirstVisitEmail] Failed to send to ${email}: ${getErrorMessage(error)}`, { extra: { error: getErrorMessage(error) } });
    return { success: false, error: getErrorMessage(error) };
  }
}
