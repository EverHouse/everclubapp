import { emailLayout, CLUB_COLORS, escapeHtml } from './emailLayout';

export function getMembershipInviteHtml(params: { firstName: string; tierName: string; priceFormatted: string; checkoutUrl: string }): string {
  const content = `
          <tr>
            <td>
              <h1 style="margin: 0 0 24px; font-size: 24px; font-weight: 600; color: ${CLUB_COLORS.textDark};">Welcome to Ever Club, ${escapeHtml(params.firstName)}!</h1>
              <p style="margin: 0 0 16px; font-size: 16px; line-height: 1.6; color: ${CLUB_COLORS.textMuted};">You've been invited to join Ever Club as a <strong>${escapeHtml(params.tierName)}</strong> member at ${escapeHtml(params.priceFormatted)}.</p>
              <p style="margin: 0 0 32px; font-size: 16px; line-height: 1.6; color: ${CLUB_COLORS.textMuted};">Click below to complete your membership signup:</p>
              <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%">
                <tr>
                  <td style="text-align: center;">
                    <a href="${params.checkoutUrl}" style="display: inline-block; padding: 14px 32px; background-color: ${CLUB_COLORS.deepGreen}; color: #ffffff; text-decoration: none; font-size: 16px; font-weight: 500; border-radius: 8px;">Complete Membership</a>
                  </td>
                </tr>
              </table>
              <p style="margin: 32px 0 0; font-size: 14px; line-height: 1.6; color: ${CLUB_COLORS.textMuted}; text-align: center;">This link will expire in 24 hours. If you have any questions, please contact us.</p>
            </td>
          </tr>
  `;

  return emailLayout(content);
}

export function getWinBackHtml(params: { firstName: string; reactivationLink: string }): string {
  const content = `
          <tr>
            <td>
              <h1 style="margin: 0 0 24px; font-size: 24px; font-weight: 600; color: ${CLUB_COLORS.textDark};">We Miss You, ${escapeHtml(params.firstName)}!</h1>
              <p style="margin: 0 0 16px; font-size: 16px; line-height: 1.6; color: ${CLUB_COLORS.textMuted};">We'd love to welcome you back to Ever Club. Your spot is waiting for you.</p>
              <p style="margin: 0 0 32px; font-size: 16px; line-height: 1.6; color: ${CLUB_COLORS.textMuted};">Click below to rejoin and pick up right where you left off:</p>
              <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%">
                <tr>
                  <td style="text-align: center;">
                    <a href="${params.reactivationLink}" style="display: inline-block; padding: 14px 32px; background-color: ${CLUB_COLORS.deepGreen}; color: #ffffff; text-decoration: none; font-size: 16px; font-weight: 500; border-radius: 8px;">Rejoin Ever Club</a>
                  </td>
                </tr>
              </table>
              <p style="margin: 32px 0 0; font-size: 14px; line-height: 1.6; color: ${CLUB_COLORS.textMuted}; text-align: center;">This link will expire in 24 hours. If you have any questions, please contact us.</p>
            </td>
          </tr>
  `;

  return emailLayout(content);
}

export function getAccountDeletionHtml(params: { firstName: string }): string {
  const content = `
          <tr>
            <td>
              <p style="margin: 0 0 16px; font-size: 16px; line-height: 1.6; color: ${CLUB_COLORS.textMuted};">Hello ${escapeHtml(params.firstName)},</p>
              <p style="margin: 0 0 16px; font-size: 16px; line-height: 1.6; color: ${CLUB_COLORS.textMuted};">We've received your request to delete your Ever Club account.</p>
              <p style="margin: 0 0 16px; font-size: 16px; line-height: 1.6; color: ${CLUB_COLORS.textMuted};">Our team will process this request within 7 business days. You will receive a confirmation email once your account has been deleted.</p>
              <p style="margin: 0 0 16px; font-size: 16px; line-height: 1.6; color: ${CLUB_COLORS.textMuted};">If you did not make this request or have changed your mind, please contact us immediately at <a href="mailto:info@everclub.app" style="color: ${CLUB_COLORS.deepGreen};">info@everclub.app</a>.</p>
              <p style="margin: 0 0 16px; font-size: 16px; line-height: 1.6; color: ${CLUB_COLORS.textMuted};">Thank you for being a part of the Ever Club community.</p>
              <p style="margin: 0; font-size: 16px; line-height: 1.6; color: ${CLUB_COLORS.textMuted};">Best regards,<br>The Ever Club Team</p>
            </td>
          </tr>
  `;

  return emailLayout(content);
}
