# Ever Club Members App

## Overview
The Ever Club Members App is a private members club application for golf and wellness centers. Its primary purpose is to streamline golf simulator bookings, wellness service appointments, and club event management. The application aims to boost member engagement, optimize operational workflows, and provide a unified digital experience. The long-term vision is to establish it as a central digital hub for private members clubs, offering comprehensive tools for membership management, facility booking, and community building to enhance member satisfaction and operational efficiency.

## User Preferences
CRITICAL: Skill-Driven Development - We have an extensive library of custom skills installed. Before answering questions, debugging, or modifying any system, you MUST identify and load the relevant skill (e.g., booking-flow, stripe-webhook-flow, fee-calculation, react-dev). Rely on your skills as the single source of truth for architectural rules.

CRITICAL: Mandatory Verification - You must NEVER complete a task or claim to be done without first explicitly invoking the verification-before-completion skill to check for Vite compilation errors, TypeScript warnings, and dev server health.

Communication Style - The founder is non-technical. Always explain changes in plain English, focusing on the business/member impact. Avoid unnecessary technical jargon.

Development Approach - Prefer iterative development. Ask before making major architectural changes. Write functional, clean code (utilize your clean-code skill).

System Non-Negotiables:

Timezone: All date/time operations must strictly prioritize Pacific Time (America/Los_Angeles).

Changelog: Update src/data/changelog.ts after EVERY significant change.

Audit Logging: ALL staff actions must be logged using logFromRequest() from server/core/auditLog.ts.

API/Frontend Consistency: Ensure API response field names EXACTLY match frontend TypeScript interfaces to avoid data mapping errors.

## System Architecture & Implementation
Our system architecture, UI/UX, and external integrations are strictly governed by our installed Agent Skills. Do not guess or assume implementation details—always load the associated skill first.

UI/UX & Frontend
Design System & Styling: Liquid Glass UI, Tailwind CSS v4, dark mode. Required Skills: ui-ux-pro-max, frontend-design, tailwind-design-system.

Interactions & Motion: Spring-physics, drag-to-dismiss. Required Skills: interaction-design, auto-animate.

React & Framework: React 19, Vite, state management (Zustand/TanStack). Required Skills: react-dev, vite, vercel-react-best-practices.

Core Domain & Technical Implementation
Project Map: Always consult project-architecture before touching, moving, or planning files.

Booking & Scheduling: "Request & Hold" model, unified participants, calendar sync. Required Skills: booking-flow, booking-import-standards.

Fees & Billing: Unified fee service, dynamic pricing, prepayment, guest fees. Required Skills: fee-calculation, billing-automation.

Database & Data Integrity: PostgreSQL, Supabase Realtime, Drizzle ORM. Required Skills: postgres-drizzle, supabase-postgres-best-practices, data-integrity-monitoring.

Member Lifecycle & Check-In: Tiers, QR/NFC check-in, onboarding. Required Skills: member-lifecycle, checkin-flow, guest-pass-system.

Maintenance: Required Skills: scheduler-jobs.

External Dependencies & Integrations
Payments (Stripe): Terminal, subscriptions. Required Skills: stripe-integration, stripe-webhook-flow.

CRM (HubSpot): Two-way sync, form submissions. Required Skills: hubspot-integration, hubspot-sync.

Communications: In-app, push, email. Required Skills: resend, notification-system, email-best-practices.

Other: Trackman (Booking CSV/webhooks), Eventbrite, Google Sheets, OpenAI Vision (ID scanning).

Future Considerations
Consult strategy-advisor and brainstorming before proposing major architectural shifts (e.g., Stripe Agent Toolkit integration).

### Data Flow & Type Casing
AI-generated casing mismatches are a critical source of bugs. You must strictly adhere to these boundaries:
- **Database Level**: PostgreSQL strictly uses `snake_case` for all tables and columns.
- **Application Level**: All TypeScript/JavaScript code (both frontend and backend) strictly uses `camelCase`.
- **The Drizzle Boundary**: Drizzle ORM is responsible for the translation. Always define schemas mapping `snake_case` DB columns to `camelCase` TS properties (e.g., `firstName: text('first_name')`).
- **The API Boundary**: All backend API responses MUST be serialized into `camelCase` before being sent to the client. Never leak `snake_case` database columns into React frontend components.
- **TypeScript Mismatches**: Never forcefully cast types with `as any`. If frontend interfaces and backend Drizzle inferred types mismatch, fix the underlying schema or DTO rather than bypassing the compiler.

### Environment & Reference Variables
Do not guess or hallucinate environment variables. We use specific naming conventions across the stack. Refer to the Replit Secrets and Configurations panel for actual values, but strictly use these keys in the code:
Frontend (Vite/React): import.meta.env.VITE_SUPABASE_URL, import.meta.env.VITE_SUPABASE_ANON_KEY

Backend/Server Core: process.env.SUPABASE_URL, process.env.SERVICE_ROLE_KEY, process.env.SESSION_SECRET

Feature Flags & App State: process.env.DEV_LOGIN_ENABLED, process.env.ENABLE_TEST_LOGIN, process.env.ENABLE_CORPORATE_BILLING, process.env.NODE_ENV

Integrations: process.env.HUBSPOT_PORTAL_ID, process.env.HUBSPOT_PRIVATE_APP_TOKEN, process.env.RESEND_API_KEY, process.env.VAPID_PUBLIC_KEY, process.env.VAPID_PRIVATE_KEY