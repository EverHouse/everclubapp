import type { Express } from 'express';

export function registerSitemapRoutes(app: Express, isProduction: boolean) {
  const siteOrigin = isProduction
    ? 'https://everclub.app'
    : `https://${process.env.REPLIT_DEV_DOMAIN || 'localhost:5000'}`;

  app.get('/robots.txt', (req, res) => {
    res.type('text/plain');
    res.send([
      'User-agent: *',
      'Disallow: /admin',
      'Disallow: /dashboard',
      'Disallow: /login',
      'Disallow: /checkout',
      'Disallow: /profile',
      'Disallow: /book',
      'Disallow: /events',
      'Disallow: /wellness',
      'Disallow: /updates',
      'Disallow: /history',
      'Disallow: /auth/',
      'Disallow: /reset-password',
      'Disallow: /join',
      'Disallow: /nfc-checkin',
      'Disallow: /dev-preview/',
      'Disallow: /_health',
      'Disallow: /healthz',
      '',
      'Allow: /api/faqs',
      'Allow: /api/events',
      'Allow: /api/wellness-classes',
      'Allow: /api/membership-tiers',
      'Allow: /api/tier-features',
      'Allow: /api/cafe-menu',
      'Allow: /api/settings/public',
      'Allow: /api/gallery',
      'Allow: /api/tours/availability',
      'Allow: /api/announcements',
      'Allow: /api/bays',
      'Allow: /api/closures',
      'Disallow: /api/',
      '',
      'Allow: /',
      '',
      `Sitemap: ${siteOrigin}/sitemap.xml`,
    ].join('\n') + '\n');
  });

  app.get('/sitemap.xml', (req, res) => {
    const publicPages = [
      { path: '/', priority: '1.0', changefreq: 'weekly' },
      { path: '/membership', priority: '0.9', changefreq: 'monthly' },
      { path: '/membership/apply', priority: '0.8', changefreq: 'monthly' },
      { path: '/about', priority: '0.8', changefreq: 'monthly' },
      { path: '/contact', priority: '0.8', changefreq: 'monthly' },
      { path: '/gallery', priority: '0.7', changefreq: 'weekly' },
      { path: '/whats-on', priority: '0.7', changefreq: 'weekly' },
      { path: '/private-hire', priority: '0.7', changefreq: 'monthly' },
      { path: '/private-hire/inquire', priority: '0.6', changefreq: 'monthly' },
      { path: '/menu', priority: '0.6', changefreq: 'monthly' },
      { path: '/tour', priority: '0.8', changefreq: 'monthly' },
      { path: '/day-pass', priority: '0.7', changefreq: 'monthly' },
      { path: '/membership/compare', priority: '0.7', changefreq: 'monthly' },
      { path: '/faq', priority: '0.5', changefreq: 'monthly' },
      { path: '/privacy', priority: '0.3', changefreq: 'yearly' },
      { path: '/terms', priority: '0.3', changefreq: 'yearly' },
    ];

    const today = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Los_Angeles' });
    const urls = publicPages.map(p =>
      `  <url>\n    <loc>${siteOrigin}${p.path}</loc>\n    <lastmod>${today}</lastmod>\n    <changefreq>${p.changefreq}</changefreq>\n    <priority>${p.priority}</priority>\n  </url>`
    ).join('\n');

    res.type('application/xml');
    res.send(
      `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls}\n</urlset>\n`
    );
  });

  app.get([
    '/sitemap_index.xml',
    '/sitemap-index.xml',
    '/sitemaps.xml',
    '/sitemap1.xml',
    '/post-sitemap.xml',
    '/page-sitemap.xml',
    '/wp-sitemap.xml',
    '/news-sitemap.xml',
  ], (req, res) => {
    res.redirect(301, '/sitemap.xml');
  });
}
