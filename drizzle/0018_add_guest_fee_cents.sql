-- Add guest_fee_cents column to membership_tiers table
ALTER TABLE "membership_tiers" ADD COLUMN "guest_fee_cents" integer DEFAULT 2500;
