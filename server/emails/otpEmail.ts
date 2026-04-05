import { emailLayout, CLUB_COLORS, escapeHtml } from './emailLayout';

export function getOtpEmailHtml(params: { firstName: string; code: string; logoUrl: string }): string {
  const safeName = escapeHtml(params.firstName);
  const content = `
                <tr>
                  <td style="text-align: center; padding-bottom: 24px;">
                    <h1 style="margin: 0 0 8px 0; font-size: 28px; font-weight: 600; color: ${CLUB_COLORS.deepGreen}; font-family: 'Georgia', serif;">Hi ${safeName},</h1>
                    <p style="margin: 0; font-size: 16px; color: #666666; line-height: 1.5;">
                      Enter this code in the Ever Club app to sign in:
                    </p>
                  </td>
                </tr>
                <tr>
                  <td style="text-align: center; padding-bottom: 12px;">
                    <div style="background: linear-gradient(135deg, ${CLUB_COLORS.deepGreen} 0%, #3d4f22 100%); padding: 24px 32px; border-radius: 12px; display: inline-block; cursor: pointer;">
                      <span style="font-size: 36px; font-weight: 700; letter-spacing: 10px; color: #ffffff; font-family: 'SF Mono', 'Monaco', 'Consolas', monospace; user-select: all;">${params.code}</span>
                    </div>
                  </td>
                </tr>
                <tr>
                  <td style="text-align: center; padding-bottom: 8px;">
                    <p style="margin: 0; font-size: 13px; color: #888888;">
                      Tap the code above to select, then copy
                    </p>
                  </td>
                </tr>
                <tr>
                  <td style="text-align: center; padding-bottom: 16px;">
                    <p style="margin: 0 0 24px 0; font-size: 14px; color: #888888;">
                      This code expires in <strong style="color: ${CLUB_COLORS.deepGreen};">15 minutes</strong>
                    </p>
                    <p style="margin: 0; font-size: 13px; color: #aaaaaa; line-height: 1.5;">
                      If you didn't request this code, you can safely ignore this email.
                    </p>
                  </td>
                </tr>`;

  return emailLayout(content, { logoUrl: params.logoUrl });
}

export function getOtpEmailText(params: { firstName: string; code: string }): string {
  return `Hi ${params.firstName},

Your Ever Club login code is: ${params.code}

Enter this code in the Ever Club app to sign in.
This code expires in 15 minutes.

If you didn't request this code, you can safely ignore this email.

Ever Club - Golf & Wellness
15771 Red Hill Ave, Ste 500, Tustin, CA 92780
https://everclub.app`;
}
