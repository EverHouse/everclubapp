---
name: email-best-practices
description: Use when building email features, emails going to spam, high bounce rates, setting up SPF/DKIM/DMARC authentication, implementing email capture, ensuring compliance (CAN-SPAM, GDPR, CASL), handling webhooks, retry logic, or deciding transactional vs marketing.
---

# Email Best Practices

Guidance for building deliverable, compliant, user-friendly emails.

## Architecture Overview

```
[User] → [Email Form] → [Validation] → [Double Opt-In]
                                              ↓
                                    [Consent Recorded]
                                              ↓
[Suppression Check] ←──────────────[Ready to Send]
        ↓
[Idempotent Send + Retry] ──────→ [Email API]
                                       ↓
                              [Webhook Events]
                                       ↓
              ┌────────┬────────┬─────────────┐
              ↓        ↓        ↓             ↓
         Delivered  Bounced  Complained  Opened/Clicked
                       ↓        ↓
              [Suppression List Updated]
                       ↓
              [List Hygiene Jobs]
```

## Quick Reference

| Need to... | See |
|------------|-----|
| Set up SPF/DKIM/DMARC, fix spam issues | [Deliverability](./resources/deliverability.md) |
| Build password reset, OTP, confirmations | [Transactional Emails](./resources/transactional-emails.md) |
| Plan which emails your app needs | [Transactional Email Catalog](./resources/transactional-email-catalog.md) |
| Build newsletter signup, validate emails | [Email Capture](./resources/email-capture.md) |
| Send newsletters, promotions | [Marketing Emails](./resources/marketing-emails.md) |
| Ensure CAN-SPAM/GDPR/CASL compliance | [Compliance](./resources/compliance.md) |
| Decide transactional vs marketing | [Email Types](./resources/email-types.md) |
| Handle retries, idempotency, errors | [Sending Reliability](./resources/sending-reliability.md) |
| Process delivery events, set up webhooks | [Webhooks & Events](./resources/webhooks-events.md) |
| Manage bounces, complaints, suppression | [List Management](./resources/list-management.md) |

## Start Here

**New app?**
Start with the [Catalog](./resources/transactional-email-catalog.md) to plan which emails your app needs (password reset, verification, etc.), then set up [Deliverability](./resources/deliverability.md) (DNS authentication) before sending your first email.

**Spam issues?**
Check [Deliverability](./resources/deliverability.md) first—authentication problems are the most common cause. Gmail/Yahoo reject unauthenticated emails.

**Marketing emails?**
Follow this path: [Email Capture](./resources/email-capture.md) (collect consent) → [Compliance](./resources/compliance.md) (legal requirements) → [Marketing Emails](./resources/marketing-emails.md) (best practices).

**Production-ready sending?**
Add reliability: [Sending Reliability](./resources/sending-reliability.md) (retry + idempotency) → [Webhooks & Events](./resources/webhooks-events.md) (track delivery) → [List Management](./resources/list-management.md) (handle bounces).

## Ever Club Email Implementation (Feb 2026)

### Centralized Sender Name

All outgoing emails use `getResendClient()` from `server/utils/resend.ts`, which returns a pre-formatted `from` address: `"Ever Club <email@domain>"`. This ensures consistent sender display name across all email types (booking confirmations, pass emails, alerts, etc.).

**Rule:** Never construct the `from` address inline. Always use the `from` value returned by `getResendClient()`. The function now returns a non-null string (changed from nullable).

### Self-Hosted QR Codes

QR codes in pass emails (day passes, guest passes) are generated server-side using the `qrcode` npm package as inline base64 data URIs. Previously, the app used an external API (`api.qrserver.com`) which triggered Resend's "host images on sending domain" deliverability warning.

**Pattern:**
```typescript
import QRCode from 'qrcode';
const qrDataUri = await QRCode.toDataURL(url, { width: 200, margin: 2 });
// Use as <img src="${qrDataUri}" /> in email HTML
```

This change required making email template functions async (they return `Promise<string>` now).

### Pass Type Display Formatting

Pass type slugs (e.g., `day-pass-golf-sim`) are formatted for display using `formatPassType()`:
1. Replace hyphens with spaces
2. Capitalize each word
3. Replace "Day Pass" prefix with "Day Pass - " separator

Result: `day-pass-golf-sim` → `Day Pass - Golf Sim`
