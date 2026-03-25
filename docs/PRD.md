# Product Requirements Document (PRD)

## Ever Club Members App

**Version:** 1.0
**Last Updated:** March 25, 2026
**Document Owner:** Ever Club Product Team
**Operating Entity:** Tempo CC Inc.

---

## Table of Contents

1. [Executive Summary](#1-executive-summary)
2. [Product Vision & Objectives](#2-product-vision--objectives)
3. [Target Users & Personas](#3-target-users--personas)
4. [User Roles & Permissions](#4-user-roles--permissions)
5. [Feature Requirements](#5-feature-requirements)
   - 5.1 [Member Portal](#51-member-portal)
   - 5.2 [Staff & Admin Portal](#52-staff--admin-portal)
   - 5.3 [Booking & Scheduling System](#53-booking--scheduling-system)
   - 5.4 [Billing & Payments](#54-billing--payments)
   - 5.5 [Membership Management](#55-membership-management)
   - 5.6 [Events & Community](#56-events--community)
   - 5.7 [Wellness Program](#57-wellness-program)
   - 5.8 [Notifications & Communication](#58-notifications--communication)
   - 5.9 [Check-In System](#59-check-in-system)
   - 5.10 [Digital Wallet Pass](#510-digital-wallet-pass)
   - 5.11 [Cafe & Amenities](#511-cafe--amenities)
   - 5.12 [Public Website & Marketing Pages](#512-public-website--marketing-pages)
   - 5.13 [Waiver & Legal Management](#513-waiver--legal-management)
   - 5.14 [Tour Booking System](#514-tour-booking-system)
   - 5.15 [Trackman Reconciliation Tools](#515-trackman-reconciliation-tools)
   - 5.16 [Data Integrity & System Health](#516-data-integrity--system-health)
   - 5.17 [Member Communications & Support](#517-member-communications--support)
   - 5.18 [Admin Settings & Configuration](#518-admin-settings--configuration)
   - 5.19 [Data Privacy & Export](#519-data-privacy--export)
   - 5.20 [Private Hire & Venue Rental](#520-private-hire--venue-rental)
6. [Membership Tiers & Pricing](#6-membership-tiers--pricing)
7. [Third-Party Integrations](#7-third-party-integrations)
8. [Data Model Overview](#8-data-model-overview)
9. [Technical Architecture](#9-technical-architecture)
10. [Security & Compliance](#10-security--compliance)
11. [Non-Functional Requirements](#11-non-functional-requirements)

---

## 1. Executive Summary

The Ever Club Members App is the central digital platform for Ever Club — a private indoor golf and social club designed for driven professionals. The app serves as a complete membership management system, handling everything from booking golf simulators and wellness classes to processing payments, managing check-ins, and fostering community engagement.

The platform serves three primary user groups: **members** who use it to book facilities, manage their membership, and engage with the club community; **staff** who use it to manage daily operations, process check-ins, and handle member requests; and **administrators** who use it for financial oversight, data integrity, and system configuration.

The app replaces the need for separate booking systems, payment platforms, and communication tools by unifying all club operations into a single, branded Progressive Web App (PWA).

---

## 2. Product Vision & Objectives

### Vision

To provide an elegant, frictionless digital experience that mirrors the elevated atmosphere of Ever Club itself — making it effortless for members to book, pay, and engage, and for staff to operate the club with precision.

### Business Objectives

| Objective | Description |
|-----------|-------------|
| Increase memberships | Streamline the application and onboarding process to convert prospects into members |
| Reduce operational friction | Automate booking approvals, fee calculations, check-ins, and billing to minimize staff workload |
| Enhance member experience | Provide a polished, mobile-first interface for all member interactions |
| Maintain exclusivity | Enforce tier-based access controls and capacity limits to preserve the private club feel |
| Drive engagement | Use events, wellness classes, and community features to increase visit frequency |
| Ensure financial accuracy | Automate fee calculations, invoice generation, and payment reconciliation |

### Success Metrics

- Member visit frequency (target: 3–4 times per week)
- Booking utilization rate across simulators and conference rooms
- Time from application to active membership
- Member retention rate
- Staff time spent on manual operations
- Payment collection rate and outstanding balance reduction

---

## 3. Target Users & Personas

### The Resident (Primary Office User)
- Uses the club as their primary workspace and social hub
- Needs a space that supports both deep work and recreation
- Values ownership of the experience
- Highest-tier membership; visits daily

### The Social (Community-First Member)
- Focused on the club environment, events, and networking
- Has a primary office elsewhere; visits several times per week
- Values access to the network, events, and technology

### The Corporate Buyer (B2B Decision Maker)
- Evaluating ROI on client entertainment and team perks
- Needs a recurring venue to host clients and build relationships
- Values the "sales tool" aspect of the venue

### The Day Pass Visitor
- Non-member experiencing the club for the first time
- Evaluating whether to join as a full member
- Limited access, single-day booking

---

## 4. User Roles & Permissions

### Role Hierarchy

| Role | Access Level | Description |
|------|-------------|-------------|
| **Admin** | Full | Complete system access: financial reports, system settings, data integrity tools, membership configuration, staff management |
| **Staff** | Operational | Club operations: booking management, member directory, check-ins, event management, HubSpot sync |
| **Member** | Self-service | Personal bookings, profile, billing, events, wellness, and community features |
| **Visitor** | Limited | Day pass redemption, limited booking access, no membership features |

### Authentication Methods

- **Email OTP**: One-time password sent via email (primary method)
- **Google OAuth**: Sign in with Google account
- **Apple Sign-In**: Sign in with Apple ID
- **Passkeys**: WebAuthn-based passwordless login

### Access Rules

- All mutating API routes require authentication
- Active membership statuses granting full access: `active`, `trialing`, `past_due`
- Restricted statuses: `cancelled`, `suspended`, `visitor`
- Staff actions are audit-logged
- Role fallback: unknown or corrupt role values default to `member`

---

## 5. Feature Requirements

### 5.1 Member Portal

#### Member Dashboard
- Chronological card layout showing upcoming bookings, events, and wellness sessions
- Split into 8 independent data sections loaded in parallel (bookings, booking requests, RSVPs, wellness, events, conference rooms, stats, announcements)
- "Add to Calendar" functionality for all scheduled items
- Pull-to-refresh with branded loading animation
- Real-time updates via WebSocket

#### Member Profile
- Personal information management (name, email, phone, address)
- Connected accounts management (link/unlink Google and Apple accounts)
- Communication preferences and marketing opt-in/out
- Digital wallet pass download (Apple Wallet)
- Membership tier and status display
- Communication log history

#### Booking History
- View past and upcoming simulator and conference room sessions
- Filter and sort capabilities
- Payment status per booking
- Cancel upcoming bookings (with refund processing)

#### Member Billing
- View and pay outstanding invoices
- Manage saved payment methods
- View subscription details and tier information
- Payment modal with Stripe Payment Element integration

#### Updates / Changelog
- Member-facing changelog showing recent app updates and improvements (`/updates`)
- Versioned entries with dates and descriptions

### 5.2 Staff & Admin Portal (Command Center)

#### Staff Command Center
- Real-time dashboard of bay occupancy and status
- Check-in queue with pending arrivals
- Urgent alerts and action items
- WebSocket-driven live updates

#### Member Directory
- Searchable database of all members
- Detailed member profiles with activity logs, notes, and billing history
- Member notes and communication logging
- Application pipeline management for new member applications

#### Booking Management
- View and manage all booking requests
- Approve, decline, or modify bookings
- Manual booking creation on behalf of members
- Participant roster management
- Bay assignment and conflict resolution

#### Content Management
- Event creation and management
- Announcements and facility closure notices
- FAQ management
- Gallery management
- Email template configuration

#### Tier Management (Admin only)
- Create and configure membership tiers
- Set daily limits, booking windows, and pricing
- Manage tier features and access controls
- Stripe product synchronization

#### Financial Management (Admin only)
- Revenue reports and financial dashboards with detailed breakdowns (revenue by payment type, outstanding balance aging, collection rate trends, per-tier revenue distribution)
- Stripe configuration management
- Data integrity checks and reconciliation tools
- POS register for in-person transactions

#### Staff & Team Management
- Manage staff accounts and roles
- Staff availability and scheduling
- Golf instructor management

### 5.3 Booking & Scheduling System

#### Booking Model: "Request & Hold"
- Members submit booking requests for available time slots
- Staff review and approve/decline requests (or auto-approve based on rules)
- Confirmed bookings create sessions linked to physical resources

#### Simulator Bookings
- Real-time availability view of all simulator bays
- Date picker strip → duration selection → time slot grid → bay/resource selection flow
- Duration filtered by player count (1 player: 30–240 min; 4 players: 120–240 min)
- Tier-based booking windows (how far in advance a member can book)
- Participant management via Player Slot Editor (up to 4 players per session)
  - Search and add other club members by name/email
  - Add guests by name and email
  - Warning for unfilled slots (not tracked, may incur guest fees)
  - Guardian consent form triggered for minor members (under 18)
- Conflict detection for overlapping bookings (checks both owner and all participants)
- Bay preference selection (specific bay or any available)
- Auto-complete scheduler for sessions past their end time
- Stale pending booking expiration
- Haptic feedback and success sounds on booking confirmation

#### Conference Room Bookings
- Separate booking flow for conference rooms
- Auto-confirmation (no staff approval required)
- Independent daily minute allowance from simulator time
- Prepayment support for overage charges

#### Calendar Synchronization
- Bidirectional sync with Google Calendar
- Facility closures sync to prevent bookings during closed periods
- Staff golf lessons create availability blocks (not closures)

#### Booking Cancellation & Modifications
- Members can cancel pending requests (immediate cancellation) or confirmed bookings (triggers cancellation flow)
- Guest passes automatically refunded if cancellation is more than 1 hour before start time
- Prepayments automatically queued for Stripe refund on cancellation
- Direct booking editing is not available to members — cancel and re-book, or staff handles modifications
- Cancellation cascade: DB status change → guest pass refund → usage ledger cleanup → Stripe refund → calendar deletion

#### Booking Status Lifecycle
Valid status transitions enforced at the database level:
- `pending` → `confirmed` / `declined` / `cancelled` / `expired`
- `confirmed` → `checked_in` / `cancelled` / `no_show`
- `checked_in` → `attended`
- Terminal statuses (no further transitions): `attended`, `no_show`, `cancelled`, `declined`, `expired`

### 5.4 Billing & Payments

#### Fee Calculation Engine
- Unified fee service producing per-participant line items
- **Overage fees**: $25.00 per 30-minute block beyond daily allowance
- **Guest fees**: $25.00 per guest when no guest passes remain
- Separate daily allowance tracking for simulators vs conference rooms
- Fee recalculation on roster changes; skips already-paid participants
- Dynamic pricing with tier-based configuration

#### Invoice Management
- One invoice per booking architecture
- Automatic draft invoice creation on booking confirmation
- Invoice finalization with Stripe Payment Element for member payment
- Draft invoice cleanup on booking cancellation
- Invoice voiding on permanent booking deletion

#### Payment Methods
- Online card payments via Stripe Payment Element
- In-person payments via Stripe Terminal (card reader)
- Staff "mark as paid" for manual/cash payments
- Balance-based payments (account credit)
- Subscription payments for recurring membership dues

#### Subscription Management
- Stripe-powered recurring billing for membership tiers
- Trial periods with automatic conversion — staff can set 7, 14, or 30-day free trials when adding new members
- Coupon and promo code support (including 100% off / $0 checkouts) — staff can create promotion codes via the Create Coupon admin form
- Subscription pause and resume
- Duplicate subscription prevention with per-email operation locks

#### Day Passes
- One-time purchase for non-members
- Stripe checkout integration
- Supports 100% promo codes

#### Group Billing
- Corporate and family billing groups
- Primary payer designation
- Volume-based corporate pricing tiers
- Sub-member management

#### POS Register
- Staff-facing point-of-sale for in-person transactions
- Cart-based ordering system
- Terminal payment integration
- Idempotency protection against duplicate charges

### 5.5 Membership Management

#### Membership Lifecycle

| Status | Description |
|--------|-------------|
| `applied` | Application submitted, awaiting review |
| `onboarding` | Approved, completing onboarding steps |
| `trialing` | In trial period (full access) |
| `active` | Full active member |
| `past_due` | Payment overdue (still has access) |
| `suspended` | Account suspended (no access) |
| `cancelled` | Membership cancelled |
| `archived` | Permanently archived |

#### Application Pipeline
- Online membership application form
- Tour booking for prospects
- Staff review and approval workflow
- HubSpot deal pipeline integration

#### Onboarding Flow
- Multi-step onboarding process
- Waiver signing requirement
- Profile completion
- Payment method setup
- Welcome communications

#### Member Archival
- Admin-initiated archival process
- Auto-cancels active subscriptions
- Cancels future bookings
- Deactivates staff entry if applicable
- Blocks future bookings/inserts on archived accounts (5 database triggers)

#### Linked Emails
- Members can link alternate email addresses to their account
- Used for matching Trackman session data to the correct member
- Domain aliasing between `evenhouse.club` and `everclub.co`

### 5.6 Events & Community

#### Event Management
- Staff create and manage club events
- Eventbrite integration for external event sync
- Member RSVP with capacity tracking
- Event categories and filtering
- Calendar integration for events

#### Announcements
- System-wide announcements displayed as banners
- Targeted announcements by tier or status
- Scheduled publish/unpublish dates

#### Facility Closures / Notices
- Block bookings during maintenance or private events
- Display closure notices to members
- Google Calendar sync for closures

#### Gallery
- Photo gallery management
- Visual showcase of club atmosphere and events

### 5.7 Wellness Program

#### Wellness Classes
- Schedule and manage fitness/wellness sessions
- Member enrollment and capacity tracking
- Calendar integration
- Class types and instructor assignments

### 5.8 Notifications & Communication

#### Notification Channels

| Channel | Implementation | Use Cases |
|---------|---------------|-----------|
| **Email** | Resend API | Booking confirmations, payment receipts, onboarding, alerts |
| **Push Notifications** | Web-Push (PWA) | Booking reminders, event notifications, status updates |
| **In-App** | Database-stored + UI | Activity feed, announcements, updates |
| **WebSocket** | Real-time broadcast | Live booking changes, check-in events, staff alerts |
| **Apple Wallet** | APNs | Background pass updates for booking changes |

#### Notification Types
- `info`, `success`, `warning`, `error`, `system`
- Business-specific: `booking`, `event`, `payment`

#### Scheduled Communications
- Daily push reminders for upcoming bookings, events, and wellness classes
- Morning closure notifications
- Stuck booking escalation alerts
- Waiver review reminders

#### Smart Deduplication
- 6-hour deduplication windows for repeating alerts
- Apple Wallet pass notifications skip PWA push when wallet pass is active

### 5.9 Check-In System

#### QR / NFC Check-In
- Members scan QR code or NFC tag on arrival
- Routes to booking check-in or walk-in visit flow
- Validates membership status and waiver compliance

#### Staff Kiosk Check-In
- Dedicated staff interface for processing arrivals
- Member search and identification
- Billing verification and prepayment enforcement
- Guest pass consumption at check-in (also triggered during bulk check-in and booking auto-complete)
- Walk-in visit recording

#### Walk-In Visit Tracking
- Records unbooked visits via QR/NFC scan
- Syncs to HubSpot for activity tracking
- WebSocket broadcast for real-time staff awareness

### 5.10 Digital Wallet Pass

#### Apple Wallet Integration
- Downloadable membership card for Apple Wallet
- Dynamic data: membership tier, remaining guest passes, booking details
- Tier-based color coding
- APNs-powered background updates when membership data changes
- Uses `node-forge` for PKCS#7 signing with Apple WWDR G4 certificate

### 5.11 Cafe & Amenities

#### Cafe Menu
- Digital menu display accessible via app (farm-to-table breakfast, lunch, specialty coffee)
- Menu items synced as Stripe products
- Ordering support through POS register
- Publicly accessible at `/menu`
- Bulk delete all inactive menu items for easy cleanup

### 5.12 Public Website & Marketing Pages

#### Informational Pages
- **Landing Page** (`/`): "Office. Course. Club." value proposition, press features (Forbes, Hypebeast, Fox 11), membership tier highlights
- **Membership Overview** (`/membership`): Tier details (Social, Core, Premium, Corporate) with "How to Join" guide
- **Membership Comparison** (`/membership/compare`): Side-by-side feature comparison of all tiers
- **Corporate Membership** (`/membership/corporate`): Volume discounts and per-employee pricing for teams
- **About** (`/about`): Club mission and philosophy
- **FAQ** (`/faq`): Common questions about membership, facility, and simulators
- **Contact** (`/contact`): Location, hours of operation, and contact information
- **Gallery** (`/gallery`): Masonry grid photo gallery with filtered views (simulators, lounge, cafe, workspace)
- **What's On** (`/whats-on`): Public event calendar with Eventbrite integration

#### Conversion Flows
- **Membership Application** (`/membership/apply`): Multi-step application form for prospective members
- **Book a Tour** (`/tour`): Schedule a 30-minute private guided tour with available time slots
- **Day Pass Purchase** (`/day-pass`): Purchase workspace or golf sim day passes with Stripe checkout; issues QR code for entry
- **Checkout** (`/checkout`): Unified checkout for public purchases

#### Legal
- **Privacy Policy** (`/privacy`) and **Terms of Service** (`/terms`)

### 5.13 Waiver & Legal Management

#### Versioned Membership Agreements
- Digital waiver/membership agreement system with version tracking (e.g., v1.0, v2.0)
- Members sign waivers directly in the app
- Signed agreement emailed to the member as formatted HTML
- Version updates identify affected members and require re-signing before facility access

#### Staff Waiver Tools
- Admin can update the current active waiver version
- Manual override to mark waivers as signed
- Stale waiver detection and review reminders
- Waiver compliance check integrated into check-in flow

### 5.14 Tour Booking System

- Dedicated tour scheduling for prospective members
- Available time slot selection (30-minute slots)
- Contact information capture (name, email, phone)
- Integration with HubSpot for lead tracking
- Tour confirmation and reminder emails via Resend
- Auto-expiration of stale/no-show tours
- Staff management interface for viewing and managing tour bookings

### 5.15 Trackman Reconciliation Tools

#### Webhook Processing
- Real-time webhook receiver for Trackman simulator activity
- Automatic session matching to app bookings by email, bay, and time (5-minute tolerance)
- Refuses ambiguous matches when multiple candidates exist

#### Unmatched Session Management
- Dedicated admin interface for resolving "ghost" sessions (Trackman activity with no app booking)
- Manual member matching tools
- Roster reconciliation comparing Trackman player count vs. app roster

#### CSV Import
- Manual upload of Trackman booking exports
- Session owner mismatch correction
- Placeholder merge for unmatched-to-matched transitions
- All Trackman-sourced participants get waived payment status (usage-tracking only, not billed)

#### Historical Backfill
- Tools and scripts for rescanning historical Trackman data
- Ensures all sessions are accounted for and properly attributed

### 5.16 Data Integrity & System Health

#### Automated Health Checks
- System health grid monitoring: Database, Stripe, HubSpot, Resend, Google Calendar
- 23 integrity checks: 8 external-system (Stripe subscription sync, billing orphans, HubSpot, Trackman, MindBody) + 15 DB-enforced/internal
- Scheduled runs for external-system checks; manual trigger for internal checks

#### Resolution Dashboard (Admin)
- Detailed issue list with categories: HubSpot Sync Mismatch, Subscription Status Drift, Orphaned Records, etc.
- "Quick Fix" buttons for one-click resolution (sync, merge, cleanup)
- Bulk fix capabilities

#### Audit Logging
- Comprehensive tracking of all staff/admin actions
- Filter by actor, resource type, and date range
- Categories: Bookings, Members, Payments, Settings

#### Sync & Maintenance Tools
- Resync individual member data from external systems
- Stripe customer cleanup (delete empty records with zero transactions)
- Stripe cache backfill (re-fetch recent payments and invoices)
- Duplicate account detection in local app and HubSpot
- Stale visitor archiving
- Ghost fee and ghost booking cleanup
- Metadata synchronization for Stripe and HubSpot
- Google Calendar extended property backfilling

#### System Monitoring
- Scheduled tasks monitor: status, last run, and results for all 28 background schedulers with master toggle
- Job queue monitor: pending, processing, completed, and failed background jobs
- HubSpot sync queue: retry counts and error logs
- Webhook monitor: incoming webhook log (Trackman, Stripe, Resend) with processing status
- Email delivery health: sent, delivered, bounced, and complained metrics via Resend webhooks
- Marketing contacts audit: identify HubSpot contacts safe to remove for billing optimization

### 5.17 Member Communications & Support

#### Staff Communication Logs
- Log interactions with members (calls, emails, in-person meetings)
- Visible on member profile for all staff
- Timestamped and attributed to the staff member who logged it

#### Member Notes
- Dedicated "Notes" tab on each member's staff-facing profile
- Internal commentary and context for staff use

#### Bug Reporting
- Built-in modal for members to report app issues
- Admin dashboard for staff to track and resolve reported bugs
- Status tracking for reported issues

#### Inquiry Management
- Pipeline for managing general inquiries and private hire requests
- Integration with HubSpot form submissions

### 5.18 Admin Settings & Configuration

#### General Settings
- Club contact information (phone, email, address)
- Social media links (Instagram, TikTok, LinkedIn)
- Operational hours (daily open/close times)
- Slot duration configuration for Golf, Conference Rooms, and Tours

#### Integration Configuration
- HubSpot Form IDs (Membership, Private Hire, etc.)
- HubSpot tier and status mapping
- Apple Messages for Business ID
- Apple Wallet Pass Type ID and Team ID

#### Scheduling Configuration
- Daily reminder send time
- Morning closure notification time
- Onboarding nudge frequency
- Grace period settings

#### Security Settings
- Kiosk exit passcode
- Notification retention duration

#### Email Template Management
- Category-level master toggles (Welcome, Booking, Passes, etc.)
- Rendered HTML previews for all system email templates

#### Resource Management
- Bay/simulator configuration
- Conference room setup
- Closure reasons and notice types

#### ID Scanner
- Integration for scanning member IDs to verify identity
- Save ID images to member profiles

#### Staff Training Library
- Training materials and internal documentation for staff

### 5.19 Data Privacy & Export

#### Member Data Export
- Members can request and download their personal data (GDPR/CCPA compliance)
- Packaged export of profile, booking history, and payment records

#### Account Deletion
- Formal workflow for members to request account removal
- Cascading cleanup of associated data

### 5.20 Private Hire & Venue Rental

#### Private Hire Information
- Public page with venue rental and full club buyout details (`/private-hire`)
- Inquiry form for event planning (`/private-hire/inquire`)
- Lead capture integrated with HubSpot

---

## 6. Membership Tiers & Pricing

### Tier Structure

Tiers are dynamically managed in the database with the following default hierarchy:

| Tier | Level | Key Benefits |
|------|-------|-------------|
| **Social** | 1 | Community access, events, networking. No included simulator minutes or guest passes — pay-per-use. |
| **Core** | 2 | Balanced access with moderate daily simulator minutes, booking window, and guest passes. |
| **Premium** | 3 | Extended daily simulator time, longer booking window, generous guest pass allocation. |
| **Corporate** | 4 | Team-based access with volume pricing and group billing. |
| **VIP** | 5 | Unlimited simulator access (999 minutes), maximum booking window, highest guest pass allocation. |

### Tier-Configurable Parameters

| Parameter | Description |
|-----------|-------------|
| `dailySimMinutes` | Minutes of simulator time included per day |
| `dailyConfRoomMinutes` | Minutes of conference room time included per day |
| `bookingWindowDays` | How far in advance a member can book (default: 7 days) |
| `guestFeeCents` | Fee charged per guest when passes are exhausted |
| `guestPassesAnnual` | Number of complimentary guest passes per year |
| `canBookSimulators` | Whether the tier allows simulator bookings |
| `canBookWellness` | Whether the tier allows wellness class enrollment |
| `unlimitedAccess` | Bypasses daily minute caps |
| `stripeProductId` | Linked Stripe product for subscription billing |

### Pricing Schedule

| Fee Type | Amount | Details |
|----------|--------|---------|
| Overage rate | $25.00 / 30 min | Charged when daily allowance is exceeded |
| Guest fee | $25.00 / guest | Charged when no guest passes remain |
| Family discount | 20% off | Applied to family add-on memberships |
| Corporate (50+ members) | $249/mo per seat | Volume pricing tier |
| Corporate (20+ members) | $275/mo per seat | Volume pricing tier |
| Corporate (10+ members) | $299/mo per seat | Volume pricing tier |
| Corporate (5+ members) | $325/mo per seat | Volume pricing tier |
| Corporate (base) | $350/mo per seat | Default corporate rate |

---

## 7. Third-Party Integrations

| Integration | Purpose | Sync Direction |
|-------------|---------|---------------|
| **Stripe** | Payment processing, subscriptions, invoices, POS terminal, product catalog | Bidirectional |
| **HubSpot** | CRM — member contacts, deals, application pipeline, form submissions, tier sync | Bidirectional (queue-based) |
| **Trackman** | Golf simulator data — session tracking, usage reconciliation, bay occupancy | Inbound (webhooks + CSV import) |
| **Google Calendar** | Booking/event/closure sync to staff calendars | Outbound |
| **Resend** | Transactional email delivery | Outbound |
| **Apple Wallet / PassKit** | Digital membership passes with APNs updates | Outbound |
| **Eventbrite** | Event import and attendee synchronization | Inbound |
| **Supabase** | Real-time WebSocket broadcasting, database heartbeat | Bidirectional |
| **Google OAuth** | Member authentication | Inbound |
| **Apple Sign-In** | Member authentication | Inbound |
| **OpenAI** | AI-powered features | Outbound |
| **Replit Object Storage** | File and asset storage | Bidirectional |
| **Google Sheets** | Data export/reporting | Outbound |
| **Mindbody** | Legacy data migration — historical member data, visit history, founding member tiers | Inbound (CSV import) |

---

## 8. Data Model Overview

### Core Entities

| Entity | Table | Description |
|--------|-------|-------------|
| Users | `users` | Central member/visitor records — email, name, role, tier, membership status, Stripe/HubSpot IDs, auth credentials |
| Staff | `staff_users` | Staff and admin accounts with role and active status |
| Membership Tiers | `membership_tiers` | Tier definitions with limits, pricing, and feature flags |
| Tier Features | `tier_features` / `tier_feature_values` | Flexible feature assignment system for tier comparisons |
| Guest Passes | `guest_passes` | Annual/monthly guest pass allocation and usage tracking. Remaining count accounts for active holds from pending bookings. |
| Resources | `resources` | Bookable assets (simulator bays, conference rooms) |
| Booking Requests | `booking_requests` | Member-initiated booking attempts with status lifecycle |
| Booking Sessions | `booking_sessions` | Actualized sessions linking requests to resources and Trackman data |
| Booking Participants | `booking_participants` | Per-session participant roster (owner, member, guest) |
| Usage Ledger | `usage_ledger` | Financial record per session — minutes charged, overage/guest fees |
| Booking Fee Snapshots | `booking_fee_snapshots` | Point-in-time fee calculations per booking |
| Events | `events` | Club events with capacity and scheduling |
| Event RSVPs | `event_rsvps` | Member event registrations |
| Wellness Classes | `wellness_classes` | Fitness/wellness session definitions |
| Wellness Enrollments | `wellness_enrollments` | Member class registrations |
| Announcements | `announcements` | System-wide notices and banners |
| Facility Closures | `facility_closures` | Scheduled closures blocking bookings |
| Notifications | `notifications` | In-app notification storage |
| Linked Emails | `user_linked_emails` | Alternate email addresses mapped to primary accounts |
| Billing Groups | `billing_groups` | Corporate/family billing group definitions |
| Group Members | `group_members` | Sub-members linked to billing groups |
| Waivers | `membership_agreements` | Versioned waiver/agreement tracking and member signatures |
| Tours | `tours` | Tour bookings for prospective members |
| Bug Reports | `bug_reports` | Member-submitted bug reports with status tracking |
| Member Notes | `member_notes` | Staff notes on individual member profiles |
| Communication Logs | `communication_logs` | Logged staff-member interactions |
| Failed Side Effects | `failed_side_effects` | Tracks cancellation side-effect failures for staff recovery |
| Subscription Locks | `subscription_locks` | Per-email operation locks preventing duplicate subscriptions |
| Magic Links | `magic_links` | OTP tokens for passwordless authentication |
| Sessions | `sessions` | User session storage for authentication |
| Passkeys | `passkeys` | WebAuthn credentials for passwordless login |

### External System Tables

| Entity | Table | Description |
|--------|-------|-------------|
| Stripe Products | `stripe_products` | Internal-to-Stripe product mapping |
| Stripe Payment Intents | `stripe_payment_intents` | Transaction attempt tracking |
| Terminal Payments | `terminal_payments` | In-person card reader transactions |
| HubSpot Deals | `hubspot_deals` | CRM deal sync |
| HubSpot Sync Queue | `hubspot_sync_queue` | Outbound HubSpot sync queue |
| Trackman Webhook Events | `trackman_webhook_events` | Raw Trackman simulator data log |
| Trackman Bay Slots | `trackman_bay_slots` | Granular simulator occupancy tracking |
| Trackman Unmatched | `trackman_unmatched_bookings` | Sessions awaiting member matching |

### Key Relationships

- **User → Tier**: `users.tier_id` → `membership_tiers.id`
- **Booking → Session → Participants**: Request creates session, session has participant roster
- **Session → Usage Ledger**: Each session generates financial records per participant
- **Billing Group → Members**: Primary payer linked to sub-member accounts
- **User → Linked Emails**: Multiple emails mapped to one primary account

---

## 9. Technical Architecture

### Technology Stack

| Layer | Technology |
|-------|-----------|
| **Frontend** | React 19, Vite, TypeScript, Tailwind CSS v4 |
| **State Management** | Zustand, TanStack Query (React Query) |
| **Backend** | Node.js, Express, TypeScript |
| **Database** | PostgreSQL (Replit-provisioned) |
| **ORM** | Drizzle ORM |
| **Real-Time** | WebSocket (custom server), Supabase Realtime |
| **Hosting** | Replit |
| **Design System** | Liquid Glass UI, M3-compliant motion tokens, dark mode |

### Application Type

Progressive Web App (PWA) — installable on mobile devices with push notification support, offline awareness, and home screen icon.

### Key Architectural Patterns

- **API Split**: Dashboard uses 8 independent endpoints loaded in parallel for resilience
- **Error Boundaries**: Three-tier system (Global → Page → Feature)
- **Optimistic Updates**: `useAppMutation` hook with automatic toasts, haptic feedback, and query invalidation
- **Prefetching**: Route-level and detail-level prefetch on hover/focus
- **Form Persistence**: Session storage persistence with unsaved changes warnings
- **Large List Rendering**: Server-side limits, progressive rendering, memoized sorting
- **Connection Health**: Offline banner monitoring network and WebSocket status

### Scheduling & Background Jobs

28 logical schedulers organized in 6 staggered startup waves:
1. Real-time operations
2. Booking & calendar sync
3. Notifications & reminders
4. Financial reconciliation
5. HubSpot & external sync
6. Cleanup & maintenance

All schedulers have overlap protection, catch-up windows, and error alerting.

### Database Integrity

- Database-level status machines for booking and membership transitions
- Trigger-based guards (stale pending, unpaid attended, archived member protection)
- Advisory locks for session creation serialization
- Deduplication indexes for Stripe customers and active invoices
- CASCADE constraints for referential integrity
- 23 integrity checks (8 external-system, 15 DB-enforced)

---

## 10. Security & Compliance

### Authentication & Authorization
- Multi-method authentication (OTP, Google OAuth, Apple Sign-In, Passkeys)
- Session-based access control with periodic revalidation
- Role-based API middleware (`isAuthenticated`, `isAdmin`, `isStaffOrAdmin`)
- WebSocket connections use cryptographic verification

### Rate Limiting
- Public endpoints creating database records are rate-limited
- Subscription creation: dedicated rate limiter + per-email operation lock
- OTP verification: three-tier rate limiting (per-IP+email, per-IP global, per-email aggregate)

### Payment Security
- PCI compliance via Stripe (card data never touches our servers)
- Idempotency keys prevent duplicate charges
- Subscription locks prevent duplicate membership creation
- Refund status tracking with double-failure logging

### Data Protection
- SQL injection prevention via parameterized queries (Drizzle ORM)
- `sql.raw()` calls validated against column allowlists
- Synthetic email guards block notifications to imported/placeholder addresses
- INNER JOIN guards prevent notifications to deleted staff
- Staff actions are audit-logged

### Legal
- Digital waiver system with version tracking
- Terms of Service and Privacy Policy
- Operating entity: Tempo CC Inc.

---

## 11. Non-Functional Requirements

### Performance
- Dashboard loads 8 sections in parallel; single-section failures don't break the page
- Prefetching on route navigation and hover/focus interactions
- Non-render-blocking font loading (Google Fonts)
- Large list pattern with server-side limits and progressive rendering
- Database indexes on all email columns (20+ tables) for fast lookups

### Reliability
- Three-tier error boundary system
- Scheduler overlap protection and staggered startup
- Connection health monitoring with offline banner
- Automatic reconnection with jitter for WebSocket
- Booking status transitions enforced at the database level (not just application)
- Failed side-effects tracked in dedicated table for staff recovery

### Accessibility & SEO
- WCAG compliance: skip navigation, focus trapping, proper ARIA roles
- `prefers-reduced-motion` respected for all animations
- All clickable non-button elements have keyboard handlers
- Consistent interaction patterns across the app
- Semantic heading structure and alt text on public-facing pages for screen reader and search engine support
- HEAD request handling for all SPA routes (monitoring tools and crawlers)

### Mobile Experience
- Mobile-first responsive design
- PWA installable with home screen icon
- Pull-to-refresh with branded animation
- Mobile status bar blending (`viewport-fit=cover`)
- Bottom navigation for mobile, navigation rail for tablet/desktop
- Haptic feedback on mutations

### Timezone & Operating Hours
- All date/time operations use Pacific Time (`America/Los_Angeles`)
- Default operating hours: Tue–Thu 8:30 AM–8 PM, Fri–Sat 8:30 AM–10 PM, Sun 10 AM–6 PM, Closed Monday (configurable via admin settings)

### Availability
- Real-time health monitoring via Supabase heartbeat
- Graceful degradation when external services are unavailable
- Connection status indicators for staff

---

*This document reflects the state of the Ever Club Members App as of March 25, 2026 (v8.97.35). It should be updated as new features are developed and requirements evolve.*
