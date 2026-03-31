import { db } from '../db';
import { sql } from 'drizzle-orm';
import { logger } from './logger';
import { getStripeClient } from './stripe/client';
import { getAppBaseUrl } from '../utils/urlUtils';
import { getErrorMessage } from '../utils/errorUtils';
import { getMembershipInviteHtml } from '../emails/memberInviteEmail';

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

interface MembershipInviteParams {
  email: string;
  firstName: string;
  lastName: string;
  tierId: number;
}

interface MembershipInviteResult {
  success: boolean;
  checkoutUrl?: string;
  emailSent: boolean;
  error?: string;
  errorCode?: 'TIER_NOT_FOUND' | 'NO_STRIPE_PRICE' | 'CHECKOUT_FAILED' | 'STRIPE_ERROR';
}

export async function createMembershipInvite(params: MembershipInviteParams): Promise<MembershipInviteResult> {
  const { email, firstName, lastName, tierId } = params;

  const sanitizedFirstName = String(firstName).trim().slice(0, 100);
  const sanitizedLastName = String(lastName).trim().slice(0, 100);

  const tierResult = await db.execute(sql`SELECT id, name, stripe_price_id, price_cents, billing_interval 
     FROM membership_tiers 
     WHERE id = ${tierId} AND is_active = true 
       AND product_type = 'subscription'
       AND billing_interval IN ('month', 'year', 'week')`);

  if (tierResult.rows.length === 0) {
    return { success: false, emailSent: false, error: 'Tier not found or inactive', errorCode: 'TIER_NOT_FOUND' };
  }

  const tier = tierResult.rows[0] as { id: number; name: string; stripe_price_id: string | null; price_cents: number; billing_interval: string };

  if (!tier.stripe_price_id) {
    return { success: false, emailSent: false, error: 'This tier has not been synced to Stripe. Please sync tiers first.', errorCode: 'NO_STRIPE_PRICE' };
  }

  let stripe;
  try {
    stripe = await getStripeClient();
  } catch (stripeInitError: unknown) {
    logger.error('[MembershipInvite] Failed to initialize Stripe client', { extra: { error: getErrorMessage(stripeInitError) } });
    return { success: false, emailSent: false, error: 'Stripe is not available. Please try again later.', errorCode: 'STRIPE_ERROR' };
  }

  const baseUrl = getAppBaseUrl();

  let session;
  try {
    session = await stripe.checkout.sessions.create({
      mode: 'subscription',
      customer_email: email,
      line_items: [
        {
          price: tier.stripe_price_id,
          quantity: 1,
        },
      ],
      success_url: `${baseUrl}/welcome?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${baseUrl}/`,
      metadata: {
        firstName: sanitizedFirstName,
        lastName: sanitizedLastName,
        tierId: String(tier.id),
        tierName: tier.name as string,
        source: 'staff_invite',
      },
    });
  } catch (stripeError: unknown) {
    logger.error('[MembershipInvite] Stripe checkout session creation failed', { extra: { error: getErrorMessage(stripeError), email } });
    return { success: false, emailSent: false, error: 'Failed to create Stripe checkout session', errorCode: 'STRIPE_ERROR' };
  }

  const checkoutUrl = session.url;

  if (!checkoutUrl) {
    logger.error('[MembershipInvite] Checkout session created but no URL returned', { extra: { sessionId: session.id, email } });
    return { success: false, emailSent: false, error: 'Failed to generate checkout URL', errorCode: 'CHECKOUT_FAILED' };
  }

  let emailSent = false;
  try {
    const { getResendClient } = await import('../utils/resend');
    const { client: resend, fromEmail } = await getResendClient();

    const priceFormatted = tier.billing_interval === 'year'
      ? `$${(Number(tier.price_cents) / 100).toFixed(0)}/year`
      : `$${(Number(tier.price_cents) / 100).toFixed(0)}/month`;

    const safeFirstName = escapeHtml(sanitizedFirstName);

    await resend.emails.send({
      from: fromEmail || 'Ever Club <noreply@everclub.app>',
      to: email,
      subject: `Your Ever Club Membership Invitation - ${tier.name}`,
      html: getMembershipInviteHtml({ firstName: safeFirstName, tierName: tier.name, priceFormatted, checkoutUrl }),
    });
    emailSent = true;
    logger.info('[MembershipInvite] Membership invite email sent', { extra: { email } });
  } catch (emailError: unknown) {
    logger.error('[MembershipInvite] Failed to send membership invite email', { extra: { error: getErrorMessage(emailError) } });
  }

  return { success: true, checkoutUrl, emailSent };
}
