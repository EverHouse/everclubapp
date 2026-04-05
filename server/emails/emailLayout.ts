import { getSettingValue } from '../core/settingsHelper';

export function escapeHtml(str: string): string {
  return str.replace(/[&<>"']/g, c => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#039;'
  }[c] || c));
}

export const CLUB_COLORS = {
  deepGreen: '#293515',
  lavender: '#CCB8E4',
  bone: '#F2F2EC',
  textDark: '#1f2937',
  textMuted: '#4b5563',
  borderLight: '#e5e7eb',
  errorRed: '#dc2626',
  warningYellow: '#ca8a04',
};

const DEFAULT_ADDRESS_LINE1 = '15771 Red Hill Ave, Ste 500';
const DEFAULT_CITY_STATE_ZIP = 'Tustin, CA 92780';

let cachedAddressLine1: string = DEFAULT_ADDRESS_LINE1;
let cachedCityStateZip: string = DEFAULT_CITY_STATE_ZIP;
let addressCacheReady = false;

export async function refreshClubAddress(): Promise<void> {
  cachedAddressLine1 = await getSettingValue('club.address_line1', DEFAULT_ADDRESS_LINE1) || DEFAULT_ADDRESS_LINE1;
  cachedCityStateZip = await getSettingValue('club.city_state_zip', DEFAULT_CITY_STATE_ZIP) || DEFAULT_CITY_STATE_ZIP;
  addressCacheReady = true;
}

export interface EmailLayoutOptions {
  addressLine1?: string;
  cityStateZip?: string;
  logoUrl?: string;
}

export function emailLayout(content: string, options?: EmailLayoutOptions): string {
  const address1 = options?.addressLine1 || (addressCacheReady ? cachedAddressLine1 : DEFAULT_ADDRESS_LINE1);
  const csz = options?.cityStateZip || (addressCacheReady ? cachedCityStateZip : DEFAULT_CITY_STATE_ZIP);

  return `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Ever Club</title>
</head>
<body style="margin: 0; padding: 0; background-color: ${CLUB_COLORS.bone}; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;">
  <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%" style="background-color: ${CLUB_COLORS.bone};">
    <tr>
      <td style="padding: 40px 20px;">
        <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%" style="max-width: 600px; margin: 0 auto; background-color: #ffffff; border-radius: 16px; box-shadow: 0 4px 24px rgba(41, 53, 21, 0.08);">
          <tr>
            <td style="padding: 40px;">
              <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%">

                <tr>
                  <td style="text-align: center; padding-bottom: 32px;">
                    <img src="${options?.logoUrl || 'https://everclub.app/images/everclub-logo-dark.png'}" alt="Ever Club" width="180" height="60" style="display: inline-block;">
                  </td>
                </tr>

                ${content}

                <tr>
                  <td style="text-align: center; padding-top: 24px; border-top: 1px solid ${CLUB_COLORS.borderLight};">
                    <p style="margin: 0 0 8px 0; font-size: 12px; color: ${CLUB_COLORS.textMuted};">
                      Questions? Reply to this email or contact us at the club.
                    </p>
                    <p style="margin: 0 0 8px 0; font-size: 11px; color: ${CLUB_COLORS.textMuted};">
                      Ever Club &bull; ${address1} &bull; ${csz}
                    </p>
                    <a href="https://everclub.app" style="font-size: 12px; color: ${CLUB_COLORS.deepGreen}; text-decoration: none;">
                      everclub.app
                    </a>
                  </td>
                </tr>

              </table>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
}

export function formatCurrency(amount: number): string {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(amount);
}

export function formatDate(date: Date): string {
  return new Intl.DateTimeFormat('en-US', {
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    timeZone: 'America/Los_Angeles',
  }).format(date);
}
