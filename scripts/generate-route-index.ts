/**
 * Route Index Generator
 *
 * Scans all route files and generates docs/ROUTE_INDEX.md with auth classification.
 * Run with: npm run docs:routes
 *
 * Auth Classification Contract
 * ----------------------------
 * The generator uses 4 detection phases in order:
 *
 * 1. Comment markers (highest precedence):
 *    Add `// PUBLIC ROUTE` or `// DEV ROUTE` directly before a router.method() declaration
 *    (with no blank lines between the comment and the declaration) to override all other
 *    detection. Use these for routes that can't be detected via middleware names.
 *    - PUBLIC ROUTE: intentionally unauthenticated (login flows, public APIs, webhooks)
 *    - DEV ROUTE:    blocked in production or requires an explicit feature flag
 *
 * 2. Middleware names on the route declaration line:
 *    isAdmin, isStaffOrAdmin, requireStaffAuth, isAuthenticated, requireAuth
 *    are detected when present as route arguments (not in the handler body).
 *
 * 3. Inline session check patterns in the handler body (first 20 lines):
 *    getSessionUser(req) + status(401|403), validateAuthToken(), req.session?.user + status(401|403)
 *
 * 4. Path patterns for well-known public webhook/form paths.
 *
 * Mount Prefix Map
 * ----------------
 * Routers mounted at non-root paths must be listed in MOUNT_PREFIX_MAP so that
 * route paths in the index reflect the actual runtime endpoint URLs.
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.resolve(__dirname, '..');
const ROUTES_DIR = path.join(ROOT, 'server', 'routes');
const OUTPUT = path.join(ROOT, 'docs', 'ROUTE_INDEX.md');

interface RouteEntry {
  method: string;
  path: string;
  file: string;
  line: number;
  auth: string;
  domain: string;
}

const DOMAIN_MAP: Record<string, string> = {
  'bays/bookings.ts': 'Bookings',
  'bays/booking-list.ts': 'Bookings',
  'bays/booking-create.ts': 'Bookings',
  'bays/booking-cancel.ts': 'Bookings',
  'bays/booking-queries.ts': 'Bookings',
  'bays/approval.ts': 'Bookings',
  'bays/calendar.ts': 'Bookings',
  'bays/resources.ts': 'Bookings',
  'bays/notifications.ts': 'Bookings',
  'bays/staff-conference-booking.ts': 'Bookings',
  'roster.ts': 'Bookings',
  'availability.ts': 'Bookings',
  'staffCheckin.ts': 'Bookings',
  'nfcCheckin.ts': 'Bookings',
  'closures.ts': 'Bookings',
  'stripe/payments.ts': 'Stripe',
  'stripe/member-payments.ts': 'Stripe',
  'stripe/member-payments/index.ts': 'Stripe',
  'stripe/member-payments/booking-payments.ts': 'Stripe',
  'stripe/member-payments/balance.ts': 'Stripe',
  'stripe/member-payments/guest-passes.ts': 'Stripe',
  'stripe/member-payments/invoices.ts': 'Stripe',
  'stripe/member-payments/saved-cards.ts': 'Stripe',
  'stripe/subscriptions.ts': 'Stripe',
  'stripe/invoices.ts': 'Stripe',
  'stripe/admin.ts': 'Stripe',
  'stripe/config.ts': 'Stripe',
  'stripe/coupons.ts': 'Stripe',
  'stripe/terminal.ts': 'Stripe',
  'stripe/booking-fees.ts': 'Stripe',
  'stripe/financial-reports.ts': 'Stripe',
  'stripe/payment-admin.ts': 'Stripe',
  'stripe/quick-charge.ts': 'Stripe',
  'trackman/webhook-index.ts': 'Trackman',
  'trackman/webhook-handlers.ts': 'Trackman',
  'trackman/webhook-billing.ts': 'Trackman',
  'trackman/webhook-matching.ts': 'Trackman',
  'trackman/webhook-modification.ts': 'Trackman',
  'trackman/webhook-receiver.ts': 'Trackman',
  'trackman/webhook-reprocess.ts': 'Trackman',
  'trackman/webhook-update.ts': 'Trackman',
  'trackman/webhook-validation.ts': 'Trackman',
  'trackman/webhook-admin-ops.ts': 'Trackman',
  'trackman/webhook-diagnostics.ts': 'Trackman',
  'trackman/webhook-helpers.ts': 'Trackman',
  'trackman/import.ts': 'Trackman',
  'trackman/admin.ts': 'Trackman',
  'trackman/admin-maintenance.ts': 'Trackman',
  'trackman/admin-resolution.ts': 'Trackman',
  'trackman/admin-roster.ts': 'Trackman',
  'trackman/admin-roster-guests.ts': 'Trackman',
  'trackman/admin-roster-management.ts': 'Trackman',
  'trackman/reconciliation.ts': 'Trackman',
  'members/dashboard.ts': 'Members',
  'members/profile.ts': 'Members',
  'members/admin-actions.ts': 'Members',
  'members/communications.ts': 'Members',
  'members/notes.ts': 'Members',
  'members/search.ts': 'Members',
  'members/visitors.ts': 'Members',
  'members/applicationPipeline.ts': 'Members',
  'members/onboarding.ts': 'Members',
  'conference/prepayment.ts': 'Conference',
  'staff/manualBooking.ts': 'Staff',
  'events/crud.ts': 'Events',
  'events/rsvp.ts': 'Events',
  'events/sync.ts': 'Events',
  'hubspot/admin.ts': 'HubSpot',
  'hubspot/contacts.ts': 'HubSpot',
  'hubspot/forms.ts': 'HubSpot',
  'hubspot/sync.ts': 'HubSpot',
  'hubspot/webhooks.ts': 'HubSpot',
  'auth.ts': 'Auth',
  'auth-google.ts': 'Auth',
  'auth-apple.ts': 'Auth',
  'auth-passkey.ts': 'Auth',
  'walletPassWebService.ts': 'Auth',
  'walletPass.ts': 'Passes',
  'analytics.ts': 'Data Tools',
  'directorySync.ts': 'Data Tools',
  'mapkit.ts': 'Other',
  'account.ts': 'Account',
  'checkout.ts': 'Checkout',
  'dayPasses.ts': 'Passes',
  'guestPasses.ts': 'Passes',
  'passes.ts': 'Passes',
  'events.ts': 'Events',
  'wellness.ts': 'Wellness',
  'tours.ts': 'Tours',
  'financials.ts': 'Financials',
  'memberBilling.ts': 'Billing',
  'myBilling.ts': 'Billing',
  'membershipTiers.ts': 'Tiers',
  'tierFeatures.ts': 'Tiers',
  'pricing.ts': 'Pricing',
  'groupBilling.ts': 'Billing',
  'hubspot.ts': 'HubSpot',
  'notifications.ts': 'Notifications',
  'announcements.ts': 'Content',
  'calendar.ts': 'Calendar',
  'cafe.ts': 'Content',
  'gallery.ts': 'Content',
  'faqs.ts': 'Content',
  'notices.ts': 'Content',
  'settings.ts': 'Settings',
  'dataIntegrity.ts': 'Data Tools',
  'dataExport.ts': 'Data Tools',
  'dataTools.ts': 'Data Tools',
  'dataTools/audit.ts': 'Data Tools',
  'dataTools/booking-tools.ts': 'Data Tools',
  'dataTools/maintenance.ts': 'Data Tools',
  'dataTools/member-sync.ts': 'Data Tools',
  'dataTools/stripe-tools.ts': 'Data Tools',
  'bugReports.ts': 'Support',
  'inquiries.ts': 'Support',
  'training.ts': 'Staff',
  'push.ts': 'Notifications',
  'waivers.ts': 'Waivers',
  'users.ts': 'Users',
  'imageUpload.ts': 'Media',
  'idScanner.ts': 'Media',
  'resources.ts': 'Resources',
  'resendWebhooks.ts': 'Webhooks',
  'mindbody.ts': 'Data Tools',
  'testAuth.ts': 'Dev',
  'emailTemplates.ts': 'Email',
  'monitoring.ts': 'Monitoring',
};

// Mount prefix map: relative file path → prefix to prepend to route paths
// Used for routers that are mounted at a non-root path in routes.ts
const MOUNT_PREFIX_MAP: Record<string, string> = {
  'testAuth.ts': '/api/auth',
  'walletPassWebService.ts': '/api/wallet',
};

function getDomain(relPath: string): string {
  return DOMAIN_MAP[relPath] || 'Other';
}

function getMountPrefix(relPath: string): string {
  return MOUNT_PREFIX_MAP[relPath] || '';
}

function detectAuth(linesBefore: string[], fullLine: string, fileLines: string[], lineIndex: number, nextRouteIndex?: number): string {
  // Phase 1: Explicit // PUBLIC ROUTE or // DEV ROUTE comments take highest precedence.
  // Only look back until the first blank line or route-closing boundary (});) to ensure
  // the comment is for THIS route and not a preceding one.
  for (let j = lineIndex - 1; j >= Math.max(0, lineIndex - 8); j--) {
    const prevLine = fileLines[j].trim();
    // Stop if we hit a blank line or a closing brace (end of previous handler)
    if (prevLine === '' || prevLine === '});' || /^\}\)/.test(prevLine)) break;
    if (/PUBLIC ROUTE/.test(prevLine)) return 'Public';
    if (/DEV ROUTE/.test(prevLine)) return 'Dev';
  }

  // Phase 2: Middleware detection — only from the route declaration line itself
  // (and up to 3 lines before for multi-line declarations).
  // Matches patterns like: router.get('/path', middlewareName, async (req, res) => {
  // We deliberately do NOT scan the handler body to avoid matching local variable names.
  const declarationContext = linesBefore.join(' ') + ' ' + fullLine;
  // Match middleware as function references passed before the final async handler
  // Strip the async handler and just examine the argument list portion
  const routeArgContext = fullLine.replace(/,\s*async\s*\(.*$/, '').replace(/,\s*\(req.*$/, '');
  const middlewareContext = linesBefore.join(' ') + ' ' + routeArgContext;

  if (/\bisAdmin\b/.test(middlewareContext) && !/\bisStaffOrAdmin\b/.test(middlewareContext)) return 'Admin';
  if (/\bisStaffOrAdmin\b/.test(middlewareContext)) return 'Staff';
  if (/\brequireStaffAuth\b/.test(middlewareContext)) return 'Staff';
  if (/\bisAuthenticated\b/.test(middlewareContext)) return 'Auth';
  if (/\brequireAuth\b/.test(middlewareContext)) return 'Auth';

  // Phase 3: Inline session check in handler body — look for explicit session guard patterns
  // only in the first ~10 lines of the handler (before meaningful business logic).
  // Use tight boundary patterns to avoid matching variable names like `const isStaffOrAdmin = ...`
  const bodyEnd = nextRouteIndex !== undefined ? Math.min(nextRouteIndex, lineIndex + 20) : lineIndex + 20;
  const handlerBody = fileLines.slice(lineIndex + 1, bodyEnd).join('\n');

  // Match getSessionUser() call and subsequent guard (used as an auth check, not just a lookup)
  if (/getSessionUser\(req\)/.test(handlerBody) && /status\(40[13]\)/.test(handlerBody.slice(0, 500))) return 'Session';
  // Match validateAuthToken() call (Apple Wallet auth protocol)
  if (/validateAuthToken\(/.test(handlerBody)) return 'Session';
  // Match req.session?.user direct access with 401 or 403 guard
  if (/req\.session\?\.user/.test(handlerBody) && /status\(40[13]\)/.test(handlerBody.slice(0, 500))) return 'Session';

  // Phase 4: Path-based public classification for well-known public webhook/callback paths
  // Note: /api/auth/ routes are NOT included here because not all auth routes are public.
  // They are individually annotated with // PUBLIC ROUTE comments instead.
  const routePathMatch = fullLine.match(/['"`](\/api\/webhooks\/|\/api\/tours\/book|\/api\/day-passes\/confirm|\/api\/availability\/batch|\/api\/hubspot\/forms)/);
  if (routePathMatch) return 'Public';

  // Check the broader declaration context (linesBefore) for module-level middleware assignments
  if (/\bisAdmin\b/.test(declarationContext) && !/\bisStaffOrAdmin\b/.test(declarationContext)) return 'Admin';
  if (/\bisStaffOrAdmin\b/.test(declarationContext)) return 'Staff';
  if (/\bisAuthenticated\b/.test(declarationContext)) return 'Auth';

  return 'None';
}

function scanFile(filePath: string): RouteEntry[] {
  const content = fs.readFileSync(filePath, 'utf-8');
  const lines = content.split('\n');
  const relPath = path.relative(ROUTES_DIR, filePath).replace(/\\/g, '/');
  const relFromRoot = path.relative(ROOT, filePath).replace(/\\/g, '/');
  const domain = getDomain(relPath);
  const entries: RouteEntry[] = [];

  const routePattern = /router\.(get|post|put|patch|delete)\s*\(\s*['"`](\/[^'"`]+)['"`]/;

  // Pre-scan to find all route declaration line indices for bounded lookahead
  const routeLineIndices: number[] = [];
  for (let i = 0; i < lines.length; i++) {
    if (routePattern.test(lines[i])) routeLineIndices.push(i);
  }

  for (let ri = 0; ri < routeLineIndices.length; ri++) {
    const i = routeLineIndices[ri];
    const match = lines[i].match(routePattern);
    if (!match) continue;

    const method = match[1].toUpperCase();
    const rawPath = match[2];
    const mountPrefix = getMountPrefix(relPath);
    // Prepend mount prefix only if the path doesn't already start with /api/
    // (routes already using /api/ are absolute and don't need the prefix)
    const routePath = mountPrefix && !rawPath.startsWith('/api/') ? mountPrefix + rawPath : rawPath;
    const contextLines = lines.slice(Math.max(0, i - 3), i + 1);
    const nextRouteIndex = ri + 1 < routeLineIndices.length ? routeLineIndices[ri + 1] : undefined;
    const auth = detectAuth(contextLines, lines[i], lines, i, nextRouteIndex);

    entries.push({
      method,
      path: routePath,
      file: relFromRoot,
      line: i + 1,
      auth,
      domain,
    });
  }

  return entries;
}

function collectRouteFiles(dir: string): string[] {
  const results: string[] = [];
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      results.push(...collectRouteFiles(full));
    } else if (entry.name.endsWith('.ts') && !entry.name.startsWith('index') && entry.name !== 'helpers.ts') {
      results.push(full);
    }
  }
  return results.sort();
}

function generateMarkdown(entries: RouteEntry[]): string {
  const grouped = new Map<string, RouteEntry[]>();
  for (const e of entries) {
    const list = grouped.get(e.domain) || [];
    list.push(e);
    grouped.set(e.domain, list);
  }

  const domainOrder = [
    'Auth', 'Account', 'Members', 'Bookings', 'Stripe', 'Billing', 'Checkout',
    'Passes', 'Trackman', 'Events', 'Wellness', 'Tours', 'Calendar', 'Conference',
    'Staff', 'Tiers', 'Pricing', 'Financials', 'HubSpot', 'Notifications',
    'Content', 'Settings', 'Data Tools', 'Support', 'Waivers', 'Users',
    'Resources', 'Media', 'Email', 'Webhooks', 'Monitoring', 'Dev', 'Other',
  ];

  const sortedDomains = [...grouped.keys()].sort((a, b) => {
    const ai = domainOrder.indexOf(a);
    const bi = domainOrder.indexOf(b);
    return (ai === -1 ? 999 : ai) - (bi === -1 ? 999 : bi);
  });

  const lines: string[] = [
    '# Route Index',
    '',
    `> Auto-generated by \`npm run docs:routes\` — do not edit manually.`,
    `> Last generated: ${new Date().toISOString().split('T')[0]}`,
    '',
    `Total routes: **${entries.length}**`,
    '',
    '## Auth Legend',
    '',
    '| Tag | Meaning |',
    '|-----|---------|',
    '| Admin | `isAdmin` middleware — admin only |',
    '| Staff | `isStaffOrAdmin` middleware — staff or admin |',
    '| Auth | `isAuthenticated` middleware — any logged-in user |',
    '| Session | Inline `getSessionUser` check — any logged-in user |',
    '| Public | Intentionally unauthenticated |',
    '| Dev | Blocked in production by env check or router-level guard |',
    '| None | No auth detected (verify manually) |',
    '',
    '---',
    '',
  ];

  for (const domain of sortedDomains) {
    const routes = grouped.get(domain)!;
    lines.push(`## ${domain}`, '');
    lines.push('| Method | Path | File | Line | Auth |');
    lines.push('|--------|------|------|------|------|');
    for (const r of routes) {
      lines.push(`| ${r.method} | \`${r.path}\` | ${r.file} | ${r.line} | ${r.auth} |`);
    }
    lines.push('');
  }

  return lines.join('\n');
}

const files = collectRouteFiles(ROUTES_DIR);
const allEntries: RouteEntry[] = [];
for (const f of files) {
  allEntries.push(...scanFile(f));
}

const markdown = generateMarkdown(allEntries);
fs.mkdirSync(path.dirname(OUTPUT), { recursive: true });
fs.writeFileSync(OUTPUT, markdown, 'utf-8');

// eslint-disable-next-line no-console
console.log(`✓ Generated ${OUTPUT} with ${allEntries.length} routes from ${files.length} files.`);
