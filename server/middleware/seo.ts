import type { Express, Request, Response, NextFunction } from 'express';

const SEO_META: Record<string, { title: string; description: string }> = {
  '/': {
    title: 'Ever Club | Golf Simulator & Social Club, Tustin OC',
    description: 'Orange County\'s premier indoor golf simulator club in Tustin, CA. Trackman simulators, coworking, farm-to-table café & wellness. Book a tour today.',
  },
  '/membership': {
    title: 'Membership Plans & Pricing | Ever Club — Tustin OC',
    description: 'Explore membership tiers at Ever Club. Social, Core, Premium & Corporate plans with Trackman golf simulator access, coworking & events in Tustin, OC.',
  },
  '/membership/apply': {
    title: 'Apply for Membership | Ever Club — OC Golf Club',
    description: 'Join OC\'s premier indoor golf & social club. Apply for membership at Ever Club in Tustin — Trackman simulators, workspace, wellness & community.',
  },
  '/private-hire': {
    title: 'Private Events & Venue Hire | Ever Club, Tustin',
    description: 'Host private events, corporate gatherings & celebrations at Ever Club in Tustin. Trackman simulator bays, conference rooms & event spaces in OC.',
  },
  '/whats-on': {
    title: 'Events & Happenings in OC | Ever Club',
    description: 'Discover golf tournaments, social nights, wellness classes & curated events at Ever Club in Tustin, OC. Browse upcoming events and RSVP today.',
  },
  '/menu': {
    title: 'Café Menu | Ever Club — Tustin, OC',
    description: 'Explore the Ever Club café menu. Farm-to-table breakfast, artisan lunch, craft coffee & curated beverages at OC\'s premier indoor golf & social club.',
  },
  '/gallery': {
    title: 'Gallery & Photos | Ever Club — Golf Club in OC',
    description: 'See inside Ever Club in Tustin. Photos of Trackman golf simulators, lounge, café, coworking spaces & member events at OC\'s private social club.',
  },
  '/contact': {
    title: 'Contact Us | Ever Club — Tustin, OC',
    description: 'Contact Ever Club at 15771 Red Hill Ave, Ste 500, Tustin, CA 92780. Membership inquiries, private events, tours & questions. (949) 545-5855.',
  },
  '/tour': {
    title: 'Book a Tour | Ever Club — Golf & Social Club, OC',
    description: 'Schedule a free 30-minute tour of Ever Club in Tustin. See Trackman golf simulators, coworking, café & wellness spaces at OC\'s top private club.',
  },
  '/day-pass': {
    title: 'Day Pass — Golf Simulator & Coworking | Ever Club OC',
    description: 'No membership needed. Buy a day pass for Trackman indoor golf simulators or premium coworking at Ever Club in Tustin, Orange County. Walk in & play.',
  },
  '/faq': {
    title: 'FAQ — Frequently Asked Questions | Ever Club',
    description: 'Got questions about Ever Club? Find answers about memberships, Trackman golf simulators, events, hours, day passes & more at our Tustin, OC location.',
  },
  '/privacy': {
    title: 'Privacy Policy | Ever Members Club',
    description: 'Read the Ever Members Club privacy policy. How we collect, use, and protect your personal data from bookings, payments & membership in Tustin, CA.',
  },
  '/terms': {
    title: 'Terms of Service | Ever Members Club',
    description: 'Ever Members Club terms of service — membership agreements, monthly fees, cancellation policy, liability waivers & guest pass rules at our Tustin, OC club.',
  },
  '/private-hire/inquire': {
    title: 'Private Event Inquiry | Ever Club — OC Venue',
    description: 'Submit an inquiry for private events at Ever Club in Tustin, OC. Golf simulator parties, corporate gatherings, celebrations & custom event packages.',
  },
  '/about': {
    title: 'About Ever Club | Golf & Social Club, Tustin OC',
    description: 'Learn about Ever Club, Orange County\'s premier indoor golf & social club in Tustin. Trackman simulators, coworking, café, events & wellness.',
  },
  '/membership/compare': {
    title: 'Compare Membership Plans | Ever Club — Tustin OC',
    description: 'Compare Ever Club membership tiers side-by-side. Features, pricing & benefits for Social, Core, Premium & Corporate plans at our Tustin, OC golf club.',
  },
};

const BASE_JSON_LD = {
  "@type": ["SportsActivityLocation", "LocalBusiness"],
  "name": "Ever Members Club",
  "alternateName": ["Ever Club", "Even House"],
  "description": "Orange County's premier private indoor golf & social club featuring Trackman simulators, premium coworking, wellness programs, and curated events.",
  "url": "https://everclub.app",
  "telephone": "+19495455855",
  "email": "info@joinever.club",
  "address": {
    "@type": "PostalAddress",
    "streetAddress": "15771 Red Hill Ave, Ste 500",
    "addressLocality": "Tustin",
    "addressRegion": "CA",
    "postalCode": "92780",
    "addressCountry": "US"
  },
  "geo": {
    "@type": "GeoCoordinates",
    "latitude": 33.709,
    "longitude": -117.8272
  },
  "areaServed": {
    "@type": "GeoCircle",
    "geoMidpoint": {
      "@type": "GeoCoordinates",
      "latitude": 33.709,
      "longitude": -117.8272
    },
    "geoRadius": "30 mi"
  },
  "priceRange": "$$$",
  "paymentAccepted": "Credit Card, Debit Card",
  "currenciesAccepted": "USD",
  "openingHoursSpecification": [
    {
      "@type": "OpeningHoursSpecification",
      "dayOfWeek": ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday"],
      "opens": "07:00",
      "closes": "22:00"
    },
    {
      "@type": "OpeningHoursSpecification",
      "dayOfWeek": ["Saturday", "Sunday"],
      "opens": "08:00",
      "closes": "22:00"
    }
  ],
  "sameAs": ["https://www.instagram.com/everhouse.app/"],
  "image": "https://everclub.app/images/hero-lounge-optimized.webp",
  "amenityFeature": [
    {"@type": "LocationFeatureSpecification", "name": "Trackman Golf Simulators", "value": true},
    {"@type": "LocationFeatureSpecification", "name": "Premium Coworking Space", "value": true},
    {"@type": "LocationFeatureSpecification", "name": "Café & Bar", "value": true},
    {"@type": "LocationFeatureSpecification", "name": "Private Event Space", "value": true},
    {"@type": "LocationFeatureSpecification", "name": "Wellness Programs", "value": true}
  ],
  "hasOfferCatalog": {
    "@type": "OfferCatalog",
    "name": "Membership Plans",
    "itemListElement": [
      {"@type": "Offer", "name": "Social Membership", "description": "Access to social events and café"},
      {"@type": "Offer", "name": "Core Membership", "description": "Golf simulator access, coworking, and events"},
      {"@type": "Offer", "name": "Premium Membership", "description": "Full access including priority booking and wellness"},
      {"@type": "Offer", "name": "Day Pass", "description": "Single-day access to golf simulators or coworking"}
    ]
  }
};

const FAQ_JSON_LD = {
  "@type": "FAQPage",
  "mainEntity": [
    {
      "@type": "Question",
      "name": "What is Ever Members Club?",
      "acceptedAnswer": {
        "@type": "Answer",
        "text": "Ever Members Club is Orange County's premier private indoor golf and social club, located in Tustin, CA. We combine Trackman golf simulators, premium coworking spaces, a café, wellness programs, and curated social events under one roof."
      }
    },
    {
      "@type": "Question",
      "name": "Where is Ever Members Club located?",
      "acceptedAnswer": {
        "@type": "Answer",
        "text": "We're located at 15771 Red Hill Ave, Ste 500, Tustin, CA 92780, in the heart of Orange County."
      }
    },
    {
      "@type": "Question",
      "name": "What golf simulators do you use?",
      "acceptedAnswer": {
        "@type": "Answer",
        "text": "We use Trackman golf simulators, the industry-leading technology used by PGA Tour professionals for practice, play, and entertainment."
      }
    },
    {
      "@type": "Question",
      "name": "Do I need a membership to visit?",
      "acceptedAnswer": {
        "@type": "Answer",
        "text": "You can experience the club with a Day Pass for golf simulators or coworking, or book a private tour to see the full facility before joining."
      }
    },
    {
      "@type": "Question",
      "name": "What membership options are available?",
      "acceptedAnswer": {
        "@type": "Answer",
        "text": "We offer Social, Core, Premium, and Corporate membership tiers, each with different levels of access to golf simulators, coworking, events, and wellness programs."
      }
    },
    {
      "@type": "Question",
      "name": "Can I host a private event at Ever Club?",
      "acceptedAnswer": {
        "@type": "Answer",
        "text": "Yes! We offer private event spaces including golf simulator bays and conference rooms for corporate events, celebrations, and social gatherings."
      }
    }
  ]
};

const TOURS_JSON_LD = {
  "@type": "TouristAttraction",
  "name": "Ever Members Club",
  "description": "Schedule a free 30-minute tour of Orange County's premier indoor golf & social club featuring Trackman simulators, premium coworking, café & wellness facilities.",
  "url": "https://everclub.app/tour",
  "address": {
    "@type": "PostalAddress",
    "streetAddress": "15771 Red Hill Ave, Ste 500",
    "addressLocality": "Tustin",
    "addressRegion": "CA",
    "postalCode": "92780",
    "addressCountry": "US"
  },
  "geo": {
    "@type": "GeoCoordinates",
    "latitude": 33.709,
    "longitude": -117.8272
  },
  "touristType": ["Golf Enthusiasts", "Professionals", "Social Groups"]
};

const EVENT_VENUE_JSON_LD = {
  "@type": "EventVenue",
  "name": "Ever Members Club — Private Event Venue",
  "description": "Host private events, corporate gatherings & celebrations at Ever Members Club in Tustin. Trackman golf simulator bays, conference rooms & elegant event spaces in Orange County.",
  "url": "https://everclub.app/private-hire",
  "address": {
    "@type": "PostalAddress",
    "streetAddress": "15771 Red Hill Ave, Ste 500",
    "addressLocality": "Tustin",
    "addressRegion": "CA",
    "postalCode": "92780",
    "addressCountry": "US"
  },
  "geo": {
    "@type": "GeoCoordinates",
    "latitude": 33.709,
    "longitude": -117.8272
  },
  "maximumAttendeeCapacity": 100,
  "telephone": "+19495455855"
};

const GEO_META_TAGS = `<meta name="geo.region" content="US-CA" />\n<meta name="geo.placename" content="Tustin, California" />\n<meta name="geo.position" content="33.709;-117.8272" />\n<meta name="ICBM" content="33.709, -117.8272" />`;

const NAV_LINKS = `<nav aria-label="Site Navigation"><ul>
<li><a href="/">Home</a></li>
<li><a href="/membership">Membership Plans</a></li>
<li><a href="/membership/compare">Compare Memberships</a></li>
<li><a href="/membership/apply">Apply for Membership</a></li>
<li><a href="/tour">Book a Tour</a></li>
<li><a href="/day-pass">Day Pass</a></li>
<li><a href="/private-hire">Private Events</a></li>
<li><a href="/whats-on">Events &amp; Happenings</a></li>
<li><a href="/menu">Caf&eacute; Menu</a></li>
<li><a href="/gallery">Gallery</a></li>
<li><a href="/about">About Ever Club</a></li>
<li><a href="/faq">FAQ</a></li>
<li><a href="/contact">Contact Us</a></li>
<li><a href="/privacy">Privacy Policy</a></li>
<li><a href="/terms">Terms of Service</a></li>
</ul></nav>`;

const FOOTER_BLOCK = `<footer>
<p>Ever Members Club &mdash; Indoor Golf &amp; Social Club</p>
<p>15771 Red Hill Ave, Ste 500, Tustin, CA 92780 | (949) 545-5855 | info@joinever.club</p>
<p>Hours: Tue&ndash;Thu 8:30 AM&ndash;8 PM | Fri&ndash;Sat 8:30 AM&ndash;10 PM | Sun 8:30 AM&ndash;6 PM | Mon Closed</p>
${NAV_LINKS}
</footer>`;

const SSR_CONTENT: Record<string, string> = {
  '/': `<div role="main">
<h1>Ever Club &mdash; Indoor Golf Simulator &amp; Social Club in Tustin, Orange County</h1>
<p>Ever Club (formerly Even House) is Orange County&rsquo;s premier private indoor golf and social club, located in Tustin, CA. Experience state-of-the-art Trackman golf simulators, premium coworking spaces, a chef-driven farm-to-table caf&eacute;, curated events, and wellness programming &mdash; all under one roof.</p>
<h2>Trackman Golf Simulators in Orange County</h2>
<p>Play year-round on four Trackman 4 simulator bays delivering tour-level ball and club data. Practice your swing, compete on 100+ championship courses, or host a league night. Our indoor golf simulators near Tustin offer the best golf simulator experience in OC &mdash; rain or shine, no tee time required.</p>
<h2>Premium Coworking &amp; Private Offices</h2>
<p>Thoughtfully designed workspaces with high-speed fiber, private offices, conference rooms, and open lounges built for focus and creative collaboration in Orange County.</p>
<h2>Farm-to-Table Caf&eacute; &amp; Bar</h2>
<p>From morning espresso to craft cocktails, our chef-driven caf&eacute; serves locally-sourced dishes in a relaxed club atmosphere.</p>
<h2>Curated Events &amp; Wellness</h2>
<p>Wine tastings, golf socials, wellness workshops, and chef-led dinners designed to build connection and community every week.</p>
<h2>Membership Plans</h2>
<p>Choose from Social, Core, Premium, and Corporate membership tiers. Each offers different levels of access to golf simulators, coworking, events, and wellness programs. <a href="/membership">Explore membership options</a> or <a href="/tour">book a private tour</a>.</p>
<h2>Private Events &amp; Venue Hire in OC</h2>
<p>Host corporate events, celebrations, and social gatherings at Ever Club. <a href="/private-hire">Learn about private events</a>.</p>
<p>As seen in <strong>Forbes</strong>, <strong>Hypebeast</strong>, and <strong>Fox 11</strong>.</p>
<p><a href="/tour">Book a Tour</a> | <a href="/membership">Explore Membership</a> | <a href="/day-pass">Get a Day Pass</a></p>
${FOOTER_BLOCK}
</div>`,

  '/membership': `<div role="main">
<h1>Membership Plans &amp; Pricing &mdash; Ever Club Indoor Golf Club, Tustin OC</h1>
<p>Join Orange County&rsquo;s premier indoor golf and social club. Ever Club offers flexible membership tiers designed for professionals who want Trackman golf simulator access, premium coworking, curated events, and wellness programming in Tustin, CA.</p>
<h2>Social Membership</h2>
<p>Access to social events, caf&eacute;, and lounge areas at Ever Club. Perfect for those who want community and connection.</p>
<h2>Core Membership</h2>
<p>Includes golf simulator access, coworking spaces, and all social events. The most popular plan for professionals in Orange County.</p>
<h2>Premium Membership</h2>
<p>Full access including priority booking, extended simulator sessions, wellness programs, and exclusive member dinners.</p>
<h2>Corporate Membership</h2>
<p>Volume-discounted plans for teams. Includes Premium-level benefits for every employee with group booking and guest passes.</p>
<h2>Day Passes Available</h2>
<p>No membership needed &mdash; try Ever Club with a <a href="/day-pass">golf simulator or coworking day pass</a>.</p>
<p><a href="/membership/compare">Compare all tiers</a> | <a href="/membership/apply">Apply now</a> | <a href="/tour">Book a tour</a></p>
${FOOTER_BLOCK}
</div>`,

  '/about': `<div role="main">
<h1>About Ever Club &mdash; Indoor Golf &amp; Social Club in Tustin, Orange County</h1>
<p>Ever Club, formerly known as Even House, is a private members club located at 15771 Red Hill Ave, Ste 500, Tustin, CA 92780, in the heart of Orange County. Founded to create a refined third space where ambitious professionals come together, the club offers an experience unlike any other in the region.</p>
<h2>What We Offer</h2>
<ul>
<li><strong>Indoor Golf Simulators</strong> &mdash; State-of-the-art Trackman 4 simulators for practice, play, and entertainment in Orange County.</li>
<li><strong>Premium Workspace</strong> &mdash; Focused coworking spaces and bookable conference rooms for professionals.</li>
<li><strong>Chef-Driven Caf&eacute;</strong> &mdash; Farm-to-table food and craft beverages from morning coffee to evening cocktails.</li>
<li><strong>Curated Events</strong> &mdash; Networking nights, golf tournaments, wine tastings, and social gatherings.</li>
<li><strong>Wellness Programs</strong> &mdash; Services and programming designed for the modern professional.</li>
<li><strong>Private Hire</strong> &mdash; Host corporate events, birthdays, and team outings in our versatile OC venue.</li>
</ul>
<h2>Our Values</h2>
<p>Community First &mdash; Quality Over Quantity &mdash; Inclusive Excellence. Whether you shoot a 70 or have never held a club, you belong here.</p>
<p><a href="/tour">Book a Tour</a> | <a href="/membership">Explore Membership</a></p>
${FOOTER_BLOCK}
</div>`,

  '/day-pass': `<div role="main">
<h1>Day Pass &mdash; Golf Simulator &amp; Coworking in Tustin, Orange County</h1>
<p>No membership required. Experience Ever Club with a day pass for Trackman golf simulators or premium coworking in Tustin, OC.</p>
<h2>Golf Simulator Day Pass</h2>
<p>Book a 60-minute session on our Trackman 4 indoor golf simulators. Play championship courses, analyze your swing data, or just have fun with friends. The best indoor golf experience near you in Orange County.</p>
<h2>Coworking Day Pass</h2>
<p>Full-day access to our premium workspace with high-speed internet, espresso, and a professional atmosphere in Tustin, CA.</p>
<p>Want unlimited access? <a href="/membership">Explore membership plans</a> or <a href="/tour">book a tour</a> to see the full club.</p>
${FOOTER_BLOCK}
</div>`,

  '/contact': `<div role="main">
<h1>Contact Ever Club &mdash; Indoor Golf &amp; Social Club, Tustin OC</h1>
<h2>Visit Us</h2>
<p>15771 Red Hill Ave, Ste 500, Tustin, CA 92780</p>
<h2>Call Us</h2>
<p>(949) 545-5855</p>
<h2>Email Us</h2>
<p>info@joinever.club</p>
<h2>Hours of Operation</h2>
<p>Monday: Closed | Tuesday&ndash;Thursday: 8:30 AM&ndash;8:00 PM | Friday&ndash;Saturday: 8:30 AM&ndash;10:00 PM | Sunday: 8:30 AM&ndash;6:00 PM</p>
<p><a href="/tour">Book a private tour</a> | <a href="/membership">Apply for membership</a></p>
${FOOTER_BLOCK}
</div>`,

  '/tour': `<div role="main">
<h1>Book a Tour &mdash; Ever Club Indoor Golf &amp; Social Club, Tustin OC</h1>
<p>Schedule a free 30-minute tour of Orange County&rsquo;s premier indoor golf and social club. See our Trackman golf simulators, premium coworking spaces, chef-driven caf&eacute;, and wellness facilities firsthand.</p>
<p>Located at 15771 Red Hill Ave, Ste 500, Tustin, CA 92780.</p>
<p><a href="/membership">Explore membership</a> | <a href="/day-pass">Try a day pass</a></p>
${FOOTER_BLOCK}
</div>`,

  '/private-hire': `<div role="main">
<h1>Private Events &amp; Venue Hire &mdash; Ever Club, Tustin, Orange County</h1>
<p>Host your next private event at Ever Club in Tustin, OC. Our versatile spaces include Trackman golf simulator bays, conference rooms, and elegant event areas perfect for corporate gatherings, celebrations, team outings, and social events.</p>
<h2>Event Spaces</h2>
<p>Full club buyouts, private simulator bays, and dedicated event areas with catering from our chef-driven kitchen.</p>
<p><a href="/private-hire/inquire">Submit an event inquiry</a> | <a href="/contact">Contact us</a></p>
${FOOTER_BLOCK}
</div>`,

  '/private-hire/inquire': `<div role="main">
<h1>Private Event Inquiry &mdash; Ever Club, Tustin OC</h1>
<p>Submit an inquiry for your next private event at Ever Club in Orange County. Golf simulator parties, corporate events, team outings, celebrations, and more.</p>
<p><a href="/private-hire">Learn about our event spaces</a> | <a href="/contact">Contact us</a></p>
${FOOTER_BLOCK}
</div>`,

  '/faq': `<div role="main">
<h1>Frequently Asked Questions &mdash; Ever Club, Tustin OC</h1>
<h2>What is Ever Members Club?</h2>
<p>Ever Members Club is Orange County&rsquo;s premier private indoor golf and social club, located in Tustin, CA. We combine Trackman golf simulators, premium coworking spaces, a caf&eacute;, wellness programs, and curated social events under one roof.</p>
<h2>Where is Ever Members Club located?</h2>
<p>15771 Red Hill Ave, Ste 500, Tustin, CA 92780, in the heart of Orange County.</p>
<h2>What golf simulators do you use?</h2>
<p>We use Trackman golf simulators, the industry-leading technology used by PGA Tour professionals.</p>
<h2>Do I need a membership to visit?</h2>
<p>You can experience the club with a <a href="/day-pass">Day Pass</a> or <a href="/tour">book a private tour</a>.</p>
<h2>What membership options are available?</h2>
<p>We offer Social, Core, Premium, and Corporate membership tiers. <a href="/membership">See all plans</a>.</p>
<h2>Can I host a private event?</h2>
<p>Yes! <a href="/private-hire">Learn about private events</a> at Ever Club.</p>
${FOOTER_BLOCK}
</div>`,

  '/gallery': `<div role="main">
<h1>Gallery &amp; Photos &mdash; Ever Club Indoor Golf &amp; Social Club, OC</h1>
<p>See inside Ever Club in Tustin, Orange County. Photos of our Trackman golf simulators, lounge, caf&eacute;, coworking spaces, and member events at OC&rsquo;s private social club.</p>
<p><a href="/tour">Book a tour</a> to experience it in person | <a href="/membership">Explore membership</a></p>
${FOOTER_BLOCK}
</div>`,

  '/menu': `<div role="main">
<h1>Caf&eacute; Menu &mdash; Ever Club, Tustin OC</h1>
<p>Explore the Ever Club caf&eacute; menu. Farm-to-table breakfast, artisan lunch, craft coffee, and curated beverages at Orange County&rsquo;s premier indoor golf and social club.</p>
<p><a href="/tour">Book a tour</a> | <a href="/membership">Explore membership</a></p>
${FOOTER_BLOCK}
</div>`,

  '/whats-on': `<div role="main">
<h1>Events &amp; Happenings &mdash; Ever Club, Tustin OC</h1>
<p>Discover golf tournaments, social nights, wellness classes, and curated events at Ever Club in Tustin, Orange County. See what&rsquo;s on and RSVP.</p>
<p><a href="/membership">Become a member</a> | <a href="/tour">Book a tour</a></p>
${FOOTER_BLOCK}
</div>`,

  '/membership/apply': `<div role="main">
<h1>Apply for Membership &mdash; Ever Club Indoor Golf Club, Orange County</h1>
<p>Join OC&rsquo;s premier indoor golf and social club. Apply for membership at Ever Club in Tustin &mdash; Trackman simulators, workspace, wellness, and community.</p>
<p><a href="/membership">View membership plans</a> | <a href="/tour">Book a tour first</a></p>
${FOOTER_BLOCK}
</div>`,

  '/membership/compare': `<div role="main">
<h1>Compare Membership Plans &mdash; Ever Club Golf Simulator Club, OC</h1>
<p>Compare Ever Club membership tiers side-by-side. See the full feature table for Social, Core, Premium, and Corporate plans at our Tustin, Orange County indoor golf club.</p>
<p><a href="/membership">Back to membership overview</a> | <a href="/membership/apply">Apply now</a></p>
${FOOTER_BLOCK}
</div>`,

  '/privacy': `<div role="main">
<h1>Privacy Policy &mdash; Ever Members Club</h1>
<p>Read the Ever Members Club privacy policy. Learn how we collect, use, and protect your personal data.</p>
${FOOTER_BLOCK}
</div>`,

  '/terms': `<div role="main">
<h1>Terms of Service &mdash; Ever Members Club</h1>
<p>Review the Ever Members Club terms of service &mdash; membership agreements, fees, cancellation policy, and guest pass rules.</p>
${FOOTER_BLOCK}
</div>`,
};

function getBreadcrumbs(routePath: string): object {
  const items: { name: string; item: string }[] = [
    { name: "Home", item: "https://everclub.app" }
  ];

  const breadcrumbMap: Record<string, { name: string; item: string }[]> = {
    '/membership': [{ name: "Membership", item: "https://everclub.app/membership" }],
    '/membership/apply': [
      { name: "Membership", item: "https://everclub.app/membership" },
      { name: "Apply", item: "https://everclub.app/membership/apply" }
    ],
    '/membership/compare': [
      { name: "Membership", item: "https://everclub.app/membership" },
      { name: "Compare Plans", item: "https://everclub.app/membership/compare" }
    ],
    '/tour': [{ name: "Book a Tour", item: "https://everclub.app/tour" }],
    '/private-hire': [{ name: "Private Events", item: "https://everclub.app/private-hire" }],
    '/private-hire/inquire': [
      { name: "Private Events", item: "https://everclub.app/private-hire" },
      { name: "Inquire", item: "https://everclub.app/private-hire/inquire" }
    ],
    '/whats-on': [{ name: "Events", item: "https://everclub.app/whats-on" }],
    '/menu': [{ name: "Café Menu", item: "https://everclub.app/menu" }],
    '/gallery': [{ name: "Gallery", item: "https://everclub.app/gallery" }],
    '/contact': [{ name: "Contact", item: "https://everclub.app/contact" }],
    '/day-pass': [{ name: "Day Pass", item: "https://everclub.app/day-pass" }],
    '/faq': [{ name: "FAQ", item: "https://everclub.app/faq" }],
    '/about': [{ name: "About", item: "https://everclub.app/about" }],
  };

  const additionalItems = breadcrumbMap[routePath] || [];
  const allItems = [...items, ...additionalItems];

  return {
    "@type": "BreadcrumbList",
    "itemListElement": allItems.map((item, index) => ({
      "@type": "ListItem",
      "position": index + 1,
      "name": item.name,
      "item": item.item
    }))
  };
}

function getJsonLdScripts(routePath: string): string {
  const graphItems: object[] = [
    {
      "@type": "Organization",
      "@id": "https://everclub.app/#organization",
      "name": "Ever Members Club",
      "alternateName": ["Ever Club", "Even House"],
      "url": "https://everclub.app",
      "logo": "https://everclub.app/images/everclub-logo-dark.webp",
      "sameAs": [
        "https://www.instagram.com/everclub/",
        "https://evenhouse.club",
        "https://www.linkedin.com/company/ever-club",
        "https://www.tiktok.com/@everclub"
      ],
      "address": {
        "@type": "PostalAddress",
        "streetAddress": "15771 Red Hill Ave, Ste 500",
        "addressLocality": "Tustin",
        "addressRegion": "CA",
        "postalCode": "92780",
        "addressCountry": "US"
      },
      "contactPoint": {
        "@type": "ContactPoint",
        "telephone": "+19495455855",
        "contactType": "customer service",
        "email": "info@joinever.club"
      }
    },
    {
      "@type": "WebSite",
      "@id": "https://everclub.app/#website",
      "url": "https://everclub.app",
      "name": "Ever Members Club",
      "publisher": { "@id": "https://everclub.app/#organization" },
      "potentialAction": {
        "@type": "SearchAction",
        "target": "https://everclub.app/faq?q={search_term_string}",
        "query-input": "required name=search_term_string"
      }
    },
    { ...BASE_JSON_LD, "@id": "https://everclub.app/#localbusiness" }
  ];

  if (routePath === '/faq') {
    graphItems.push(FAQ_JSON_LD);
  }
  if (routePath === '/tour') {
    graphItems.push(TOURS_JSON_LD);
  }
  if (routePath === '/private-hire') {
    graphItems.push(EVENT_VENUE_JSON_LD);
  }
  if (routePath === '/about') {
    graphItems.push({
      "@type": "AboutPage",
      "name": "About Ever Club",
      "description": "Learn about Ever Club, Orange County's premier indoor golf & social club in Tustin.",
      "url": "https://everclub.app/about",
      "mainEntity": {
        "@type": "Organization",
        "name": "Ever Members Club"
      }
    });
  }

  if (routePath !== '/') {
    graphItems.push(getBreadcrumbs(routePath));
  }

  return `<script type="application/ld+json">${JSON.stringify({ "@context": "https://schema.org", "@graph": graphItems })}</script>`;
}

export const injectCspNonce = (html: string, nonce: string): string => {
  return html
    .replace(/<script(?![^>]*type\s*=\s*["']application\/ld\+json["'])(?=[\s>])/gi, `<script nonce="${nonce}"`)
    .replace(/<style(?=[\s>])/gi, `<style nonce="${nonce}"`);
};

export interface SeoMiddlewareOptions {
  getCachedIndexHtml: () => string | null;
  getMainCssPath: () => string | null;
  siteOrigin: string;
  distDir: string;
}

export function seoMiddleware(options: SeoMiddlewareOptions) {
  return (req: Request, res: Response, next: NextFunction) => {
    if ((req.method === 'GET' || req.method === 'HEAD') && !req.path.startsWith('/api/') && !req.path.startsWith('/assets/') && req.path !== '/healthz' && req.path !== '/_health') {
      const cachedHtml = options.getCachedIndexHtml();
      if (!cachedHtml) {
        const path = require('path') as typeof import('path');
        const indexPath = path.join(options.distDir, 'index.html');
        try {
          const { readFileSync } = require('fs') as typeof import('fs');
          const rawHtml = readFileSync(indexPath, 'utf8');
          const nonce = res.locals.cspNonce as string;
          res.setHeader('Content-Type', 'text/html');
          return res.send(injectCspNonce(rawHtml, nonce));
        } catch {
          return res.sendFile(indexPath);
        }
      }

      const routePath = req.path.replace(/\/+$/, '') || '/';
      const meta = SEO_META[routePath];
      const nonce = res.locals.cspNonce as string;

      res.setHeader('Content-Type', 'text/html');
      res.setHeader('Cache-Control', 'no-cache, must-revalidate');
      res.setHeader('Pragma', 'no-cache');
      res.setHeader('Expires', '0');
      const linkHints = ['</images/hero-lounge-optimized.webp>; rel=preload; as=image; type=image/webp'];
      const currentCssPath = options.getMainCssPath();
      if (currentCssPath) {
        linkHints.push(`<${currentCssPath}>; rel=preload; as=style; crossorigin`);
      }
      linkHints.push('<https://fonts.googleapis.com>; rel=preconnect');
      linkHints.push('<https://fonts.gstatic.com>; rel=preconnect; crossorigin');
      res.setHeader('Link', linkHints.join(', '));

      const injectSsrContent = (html: string, route: string): string => {
        const ssrBlock = SSR_CONTENT[route];
        if (ssrBlock) {
          return html.replace(
            /<noscript>\s*<div role="main">[\s\S]*?<\/div>\s*<\/noscript>/,
            `<noscript>${ssrBlock}</noscript>`
          );
        }
        return html;
      };

      if (meta) {
        const ogUrl = `${options.siteOrigin}${routePath === '/' ? '' : routePath}`;
        let html = cachedHtml;
        html = html.replace(/<title>[^<]*<\/title>/, `<title>${meta.title}</title>`);
        html = html.replace(/<meta name="description"[^>]*>/, `<meta name="description" content="${meta.description}" />`);
        html = html.replace(/<meta property="og:title"[^>]*>/, `<meta property="og:title" content="${meta.title}" />`);
        html = html.replace(/<meta property="og:description"[^>]*>/, `<meta property="og:description" content="${meta.description}" />`);
        html = html.replace(/<meta property="og:url"[^>]*>/, `<meta property="og:url" content="${ogUrl}" />`);
        html = html.replace(/<meta name="twitter:title"[^>]*>/, `<meta name="twitter:title" content="${meta.title}" />`);
        html = html.replace(/<meta name="twitter:description"[^>]*>/, `<meta name="twitter:description" content="${meta.description}" />`);
        html = html.replace(/<link rel="canonical"[^>]*>/, `<link rel="canonical" href="${ogUrl}" />`);
        html = html.replace('</head>', `${GEO_META_TAGS}\n${getJsonLdScripts(routePath)}\n</head>`);
        html = injectSsrContent(html, routePath);
        return res.send(injectCspNonce(html, nonce));
      }

      let html = cachedHtml;
      const fallbackUrl = `${options.siteOrigin}${routePath === '/' ? '' : routePath}`;
      html = html.replace(/<meta property="og:url"[^>]*>/, `<meta property="og:url" content="${fallbackUrl}" />`);
      html = html.replace(/<link rel="canonical"[^>]*>/, `<link rel="canonical" href="${fallbackUrl}" />`);
      html = html.replace('</head>', `${GEO_META_TAGS}\n${getJsonLdScripts(routePath)}\n</head>`);
      html = injectSsrContent(html, routePath);
      return res.send(injectCspNonce(html, nonce));
    }
    next();
  };
}
