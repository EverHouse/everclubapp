import { Resend } from 'resend';
import { logger } from '../core/logger';
import { db } from '../db';
import { sql } from 'drizzle-orm';
import { getErrorMessage } from '../utils/errorUtils';
import { withResendRetry } from '../core/retryUtils';

interface ResendConnectionSettings {
  api_key: string;
  from_email?: string;
}

const CREDENTIAL_CACHE_TTL_MS = 5 * 60 * 1000;
let cachedClient: { client: Resend; fromEmail: string } | null = null;
let cachedAt = 0;
let inflightCredentialFetch: Promise<{ client: Resend; fromEmail: string }> | null = null;

const isDevelopment = process.env.NODE_ENV !== 'production' && !process.env.WEB_REPL_RENEWAL;

const ALLOWED_DEV_EMAILS = [
  '@everclub.co',
  '@evenhouse.club',
  'nicholasallanluu@gmail.com',
];

function isAllowedInDev(email: string): boolean {
  const lowerEmail = email.toLowerCase();
  return ALLOWED_DEV_EMAILS.some(allowed => 
    allowed.startsWith('@') 
      ? lowerEmail.endsWith(allowed) 
      : lowerEmail === allowed
  );
}

async function getCredentialsFromConnector(): Promise<{ apiKey: string; fromEmail?: string }> {
  const hostname = process.env.REPLIT_CONNECTORS_HOSTNAME;
  const xReplitToken = process.env.REPL_IDENTITY 
    ? 'repl ' + process.env.REPL_IDENTITY 
    : process.env.WEB_REPL_RENEWAL 
    ? 'depl ' + process.env.WEB_REPL_RENEWAL 
    : null;

  if (!xReplitToken) {
    throw new Error('X_REPLIT_TOKEN not found for repl/depl');
  }

  const connectorResponse = await fetch(
    'https://' + hostname + '/api/v2/connection?include_secrets=true&connector_names=resend',
    {
      headers: {
        'Accept': 'application/json',
        'X_REPLIT_TOKEN': xReplitToken
      }
    }
  );

  if (!connectorResponse.ok) {
    const errorText = await connectorResponse.text().catch(() => 'unknown');
    throw new Error(`Resend connector API error (HTTP ${connectorResponse.status}): ${errorText.substring(0, 200)}`);
  }

  const connectionSettings = await connectorResponse.json().then((data: unknown) => {
    const parsed = data as Record<string, unknown>;
    return (parsed.items as Record<string, unknown>[] | undefined)?.[0] ?? null;
  });

  const settings = connectionSettings?.settings as ResendConnectionSettings | undefined;
  if (!settings?.api_key) {
    throw new Error('Resend not connected');
  }
  return { apiKey: settings.api_key, fromEmail: settings.from_email };
}

async function getCredentials(): Promise<{ apiKey: string; fromEmail?: string }> {
  try {
    return await getCredentialsFromConnector();
  } catch (connectorError: unknown) {
    if (process.env.RESEND_API_KEY) {
      logger.info('[Resend] Connector unavailable, using RESEND_API_KEY fallback', {
        extra: { connectorError: getErrorMessage(connectorError) }
      });
      return { apiKey: process.env.RESEND_API_KEY, fromEmail: undefined };
    }
    throw connectorError;
  }
}

export async function getResendClient(): Promise<{ client: Resend; fromEmail: string }> {
  if (cachedClient && Date.now() - cachedAt < CREDENTIAL_CACHE_TTL_MS) {
    return cachedClient;
  }
  if (inflightCredentialFetch) {
    return inflightCredentialFetch;
  }
  inflightCredentialFetch = (async () => {
    try {
      const { apiKey, fromEmail } = await getCredentials();
      const rawEmail = fromEmail || 'noreply@everclub.app';
      const formattedFrom = rawEmail.includes('<') ? rawEmail : `Ever Club <${rawEmail}>`;
      cachedClient = { client: new Resend(apiKey), fromEmail: formattedFrom };
      cachedAt = Date.now();
      return cachedClient;
    } finally {
      inflightCredentialFetch = null;
    }
  })();
  return inflightCredentialFetch;
}

export interface SafeSendOptions {
  to: string | string[];
  subject: string;
  html: string;
  text?: string;
  from?: string;
  replyTo?: string;
  skipSuppressionCheck?: boolean;
}

export async function safeSendEmail(options: SafeSendOptions): Promise<{ success: boolean; blocked?: boolean; suppressed?: boolean; id?: string }> {
  const recipients = Array.isArray(options.to) ? options.to : [options.to];
  
  if (isDevelopment) {
    const blockedRecipients = recipients.filter(email => !isAllowedInDev(email));
    
    if (blockedRecipients.length > 0) {
      logger.warn('DEV MODE: Blocking email to non-allowed recipients', {
        extra: {
          blockedRecipients,
          subject: options.subject,
          allowedRecipients: recipients.filter(email => isAllowedInDev(email))
        }
      });
      
      const allowedRecipients = recipients.filter(email => isAllowedInDev(email));
      if (allowedRecipients.length === 0) {
        return { success: true, blocked: true };
      }
      
      options.to = allowedRecipients;
    }
  }
  
  if (!options.skipSuppressionCheck) {
    try {
      const suppressedRecipients = await checkEmailSuppression(recipients);
      if (suppressedRecipients.length > 0) {
        const remaining = recipients.filter(e => !suppressedRecipients.includes(e.toLowerCase()));
        logger.info('[Email] Suppressed delivery to bounced/complained recipients', {
          extra: { suppressed: suppressedRecipients, subject: options.subject }
        });
        if (remaining.length === 0) {
          return { success: true, suppressed: true };
        }
        options.to = remaining;
      }
    } catch (suppressErr: unknown) {
      logger.warn('[Email] Suppression list check failed, proceeding with send', { extra: { error: getErrorMessage(suppressErr) } });
    }
  }

  try {
    const { client, fromEmail } = await getResendClient();
    const senderEmail = options.from || fromEmail || 'noreply@everclub.app';
    const from = senderEmail.includes('<') ? senderEmail : `Ever Club <${senderEmail}>`;
    const sendPayload: Record<string, unknown> = {
      from,
      to: options.to,
      subject: options.subject,
      html: options.html,
      replyTo: options.replyTo
    };
    if (options.text) sendPayload.text = options.text;
    const result = await withResendRetry(() =>
      client.emails.send(sendPayload as unknown as Parameters<typeof client.emails.send>[0])
    );
    
    const emailId = result.data?.id || null;
    const finalRecipients = Array.isArray(options.to) ? options.to : [options.to];
    try {
      for (const recipient of finalRecipients) {
        await db.execute(sql`
          INSERT INTO email_events (event_id, event_type, email_id, recipient_email, subject, event_data)
          VALUES (
            ${`local-sent-${emailId || Date.now()}-${recipient}`},
            'email.sent',
            ${emailId},
            ${recipient},
            ${options.subject || null},
            ${JSON.stringify({ from: options.from, to: finalRecipients, subject: options.subject, source: 'local' })}
          )
          ON CONFLICT (event_id) DO NOTHING
        `);
      }
    } catch (trackErr: unknown) {
      logger.warn('Failed to track sent email event locally', { extra: { error: getErrorMessage(trackErr) } });
    }

    return { success: true, id: emailId || undefined };
  } catch (error: unknown) {
    logger.error('Failed to send email', {
      extra: { error: getErrorMessage(error), subject: options.subject, to: options.to }
    });
    return { success: false };
  }
}

export async function checkEmailSuppression(emails: string[]): Promise<string[]> {
  if (emails.length === 0) return [];
  const lowerEmails = emails.map(e => e.toLowerCase());
  try {
    const result = await db.execute(sql`
      SELECT LOWER(email) as email FROM users
      WHERE LOWER(email) = ANY(${lowerEmails})
        AND email_delivery_status IN ('bounced', 'complained')
    `);
    return (result.rows as Array<{ email: string }>).map(r => r.email);
  } catch { /* intentional: suppression check failure — return empty to avoid blocking sends */
    return [];
  }
}

export function logDevEmailGuardStatus() {
  if (isDevelopment) {
    logger.info('DEV MODE: Email guard active - only sending to allowed addresses', {
      extra: { allowedPatterns: ALLOWED_DEV_EMAILS }
    });
  } else {
    logger.info('PRODUCTION MODE: All emails will be sent');
  }
}
