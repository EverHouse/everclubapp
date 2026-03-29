export function getOtpEmailHtml(params: { firstName: string; code: string; logoUrl: string }): string {
  return `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta name="x-apple-disable-message-reformatting">
  <title>Your Ever Club Login Code</title>
</head>
<body style="margin: 0; padding: 0; background-color: #F2F2EC; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;">
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background-color: #F2F2EC;">
    <tr>
      <td align="center" style="padding: 40px 20px;">
        <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width: 480px; background-color: #ffffff; border-radius: 16px; box-shadow: 0 4px 24px rgba(41, 53, 21, 0.08);">
          <tr>
            <td style="padding: 48px 40px 32px 40px; text-align: center;">
              <img src="${params.logoUrl}" alt="Ever Club" width="180" height="60" style="display: inline-block; margin-bottom: 24px;">
              <h1 style="margin: 0 0 8px 0; font-size: 28px; font-weight: 600; color: #293515; font-family: 'Georgia', serif;">Hi ${params.firstName},</h1>
              <p style="margin: 0; font-size: 16px; color: #666666; line-height: 1.5;">
                Enter this code in the Ever Club app to sign in:
              </p>
            </td>
          </tr>
          <tr>
            <td style="padding: 0 40px 12px 40px; text-align: center;">
              <div style="background: linear-gradient(135deg, #293515 0%, #3d4f22 100%); padding: 24px 32px; border-radius: 12px; display: inline-block; cursor: pointer;">
                <span style="font-size: 36px; font-weight: 700; letter-spacing: 10px; color: #ffffff; font-family: 'SF Mono', 'Monaco', 'Consolas', monospace; user-select: all;">${params.code}</span>
              </div>
            </td>
          </tr>
          <tr>
            <td style="padding: 0 40px 8px 40px; text-align: center;">
              <p style="margin: 0; font-size: 13px; color: #888888;">
                Tap the code above to select, then copy
              </p>
            </td>
          </tr>
          <tr>
            <td style="padding: 0 40px 40px 40px; text-align: center;">
              <p style="margin: 0 0 24px 0; font-size: 14px; color: #888888;">
                This code expires in <strong style="color: #293515;">15 minutes</strong>
              </p>
              <p style="margin: 0; font-size: 13px; color: #aaaaaa; line-height: 1.5;">
                If you didn't request this code, you can safely ignore this email.
              </p>
            </td>
          </tr>
          <tr>
            <td style="padding: 24px 40px; background-color: #f8f8f6; border-radius: 0 0 16px 16px; text-align: center;">
              <p style="margin: 0 0 4px 0; font-size: 12px; color: #999999;">
                Ever Club &middot; <span style="color: #293515;">Golf & Wellness</span>
              </p>
              <p style="margin: 0; font-size: 11px; color: #bbbbbb; line-height: 1.4;">
                5951 Village Center Dr, Austin, TX 78739
              </p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>
`;
}

export function getOtpEmailText(params: { firstName: string; code: string }): string {
  return `Hi ${params.firstName},

Your Ever Club login code is: ${params.code}

Enter this code in the Ever Club app to sign in.
This code expires in 15 minutes.

If you didn't request this code, you can safely ignore this email.

Ever Club - Golf & Wellness
5951 Village Center Dr, Austin, TX 78739
https://everclub.app`;
}
