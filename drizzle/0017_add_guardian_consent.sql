-- Add guardian consent fields for minor bookings (under 18)
ALTER TABLE "booking_requests" ADD COLUMN "guardian_name" varchar;
ALTER TABLE "booking_requests" ADD COLUMN "guardian_relationship" varchar;
ALTER TABLE "booking_requests" ADD COLUMN "guardian_phone" varchar;
ALTER TABLE "booking_requests" ADD COLUMN "guardian_consent_at" timestamp;
