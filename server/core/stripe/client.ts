import Stripe from 'stripe';

let cachedCredentials: { publishableKey: string; secretKey: string } | null = null;
let credentialsFetchPromise: Promise<{ publishableKey: string; secretKey: string }> | null = null;
const CREDENTIALS_TTL_MS = 5 * 60 * 1000;
let credentialsCachedAt = 0;

let cachedStripeClient: Stripe | null = null;
let cachedStripeSecretKey: string | null = null;

function getReplitConnectorAuth(): { hostname: string; xReplitToken: string } {
  const hostname = process.env.REPLIT_CONNECTORS_HOSTNAME;
  const xReplitToken = process.env.REPL_IDENTITY
    ? 'repl ' + process.env.REPL_IDENTITY
    : process.env.WEB_REPL_RENEWAL
      ? 'depl ' + process.env.WEB_REPL_RENEWAL
      : null;
  if (!xReplitToken || !hostname) {
    throw new Error('Replit connector auth not available (no REPL_IDENTITY, WEB_REPL_RENEWAL, or REPLIT_CONNECTORS_HOSTNAME)');
  }
  return { hostname, xReplitToken };
}

async function fetchStripeConnection(hostname: string, xReplitToken: string, environment?: string): Promise<{ publishableKey: string; secretKey: string }> {
  const url = new URL(`https://${hostname}/api/v2/connection`);
  url.searchParams.set('include_secrets', 'true');
  url.searchParams.set('connector_names', 'stripe');
  if (environment) {
    url.searchParams.set('environment', environment);
  }

  const response = await fetch(url.toString(), {
    headers: {
      'Accept': 'application/json',
      'X_REPLIT_TOKEN': xReplitToken
    }
  });

  if (!response.ok) {
    const text = await response.text().catch(() => '(no body)');
    throw new Error(`Stripe connector request failed (${response.status}): ${text.slice(0, 200)}`);
  }

  const data = await response.json() as { items?: Array<Record<string, unknown>> };
  const connectionSettings = data.items?.[0];

  const settings = connectionSettings?.settings as { publishable?: string; secret?: string } | undefined;
  if (!connectionSettings || !settings || (!settings.publishable || !settings.secret)) {
    throw new Error(`Stripe ${environment || 'default'} connection not found`);
  }

  return {
    publishableKey: settings.publishable as string,
    secretKey: settings.secret as string,
  };
}

async function getCredentials() {
  const now = Date.now();
  if (cachedCredentials && (now - credentialsCachedAt) < CREDENTIALS_TTL_MS) {
    return cachedCredentials;
  }

  if (credentialsFetchPromise) {
    return credentialsFetchPromise;
  }

  credentialsFetchPromise = (async () => {
    try {
      const isProduction = process.env.REPLIT_DEPLOYMENT === '1';

      let creds: { publishableKey: string; secretKey: string };
      if (!isProduction) {
        const testSecret = process.env.STRIPE_TEST_SECRET_KEY;
        const testPublishable = process.env.STRIPE_TEST_PUBLISHABLE_KEY;
        if (testSecret && testPublishable) {
          creds = { publishableKey: testPublishable, secretKey: testSecret };
        } else {
          const { hostname, xReplitToken } = getReplitConnectorAuth();
          try {
            creds = await fetchStripeConnection(hostname, xReplitToken, 'development');
          } catch {
            creds = await fetchStripeConnection(hostname, xReplitToken);
          }
        }
      } else {
        const { hostname, xReplitToken } = getReplitConnectorAuth();
        creds = await fetchStripeConnection(hostname, xReplitToken, 'production');
      }

      cachedCredentials = creds;
      credentialsCachedAt = Date.now();

      if (cachedStripeSecretKey && cachedStripeSecretKey !== creds.secretKey) {
        cachedStripeClient = null;
        cachedStripeSecretKey = null;
        stripeSync = null;
      }

      return creds;
    } finally {
      credentialsFetchPromise = null;
    }
  })();

  return credentialsFetchPromise;
}

export async function getStripeClient(): Promise<Stripe> {
  const { secretKey } = await getCredentials();

  if (cachedStripeClient && cachedStripeSecretKey === secretKey) {
    return cachedStripeClient;
  }

  cachedStripeClient = new Stripe(secretKey, {
    apiVersion: Stripe.API_VERSION as Stripe.LatestApiVersion,
  });
  cachedStripeSecretKey = secretKey;
  return cachedStripeClient;
}

export async function getStripePublishableKey(): Promise<string> {
  const { publishableKey } = await getCredentials();
  return publishableKey;
}

export async function getStripeSecretKey(): Promise<string> {
  const { secretKey } = await getCredentials();
  return secretKey;
}

export async function getStripeEnvironmentInfo(): Promise<{ isLive: boolean; mode: 'live' | 'test'; isProduction: boolean }> {
  const { secretKey } = await getCredentials();
  const isLive = secretKey.startsWith('sk_live_') || secretKey.startsWith('rk_live_');
  const isProduction = process.env.REPLIT_DEPLOYMENT === '1';
  return { isLive, mode: isLive ? 'live' : 'test', isProduction };
}

let stripeSync: unknown = null;

export async function getStripeSync() {
  if (!stripeSync) {
    const { StripeSync } = await import('stripe-replit-sync');
    const secretKey = await getStripeSecretKey();

    const { pool: dbPool } = await import('../db');
    const effectiveUrl = (dbPool as { options?: { connectionString?: string } }).options?.connectionString || '';
    if (!effectiveUrl) {
      throw new Error('[StripeSync] No database connection string available');
    }
    const { stripSslMode } = await import('../db');
    const cleanUrl = stripSslMode(effectiveUrl) || effectiveUrl;
    const isLocal = (() => { try { return ['localhost','127.0.0.1','helium'].includes(new URL(cleanUrl).hostname); } catch { return false; } })();
    const needsSsl = !isLocal;
    stripeSync = new StripeSync({
      poolConfig: {
        connectionString: effectiveUrl,
        max: 2,
        ssl: needsSsl ? { rejectUnauthorized: false } : undefined,
        statement_timeout: 30000,
        query_timeout: 30000,
      },
      stripeSecretKey: secretKey,
    });
  }
  return stripeSync;
}
