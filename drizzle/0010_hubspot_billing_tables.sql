-- HubSpot Billing Integration Tables

-- Product mappings: links HubSpot products to membership tiers and fee types
CREATE TABLE IF NOT EXISTS "hubspot_product_mappings" (
  "id" SERIAL PRIMARY KEY,
  "hubspot_product_id" VARCHAR NOT NULL UNIQUE,
  "product_name" VARCHAR NOT NULL,
  "product_type" VARCHAR NOT NULL,
  "tier_name" VARCHAR,
  "unit_price" NUMERIC(10, 2) NOT NULL,
  "billing_frequency" VARCHAR,
  "description" TEXT,
  "is_active" BOOLEAN DEFAULT true,
  "created_at" TIMESTAMP DEFAULT NOW(),
  "updated_at" TIMESTAMP DEFAULT NOW()
);

-- Discount rules: defines discount percentages for different member tags
CREATE TABLE IF NOT EXISTS "discount_rules" (
  "id" SERIAL PRIMARY KEY,
  "discount_tag" VARCHAR NOT NULL UNIQUE,
  "discount_percent" INTEGER NOT NULL DEFAULT 0,
  "description" TEXT,
  "is_active" BOOLEAN DEFAULT true,
  "created_at" TIMESTAMP DEFAULT NOW(),
  "updated_at" TIMESTAMP DEFAULT NOW()
);

-- HubSpot deals: tracks member deals and their pipeline stages
CREATE TABLE IF NOT EXISTS "hubspot_deals" (
  "id" SERIAL PRIMARY KEY,
  "member_email" VARCHAR NOT NULL,
  "hubspot_contact_id" VARCHAR,
  "hubspot_deal_id" VARCHAR NOT NULL UNIQUE,
  "deal_name" VARCHAR,
  "pipeline_id" VARCHAR,
  "pipeline_stage" VARCHAR,
  "last_known_mindbody_status" VARCHAR,
  "last_stage_sync_at" TIMESTAMP,
  "last_sync_error" TEXT,
  "created_at" TIMESTAMP DEFAULT NOW(),
  "updated_at" TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS "hubspot_deals_member_email_idx" ON "hubspot_deals" ("member_email");
CREATE INDEX IF NOT EXISTS "hubspot_deals_hubspot_deal_id_idx" ON "hubspot_deals" ("hubspot_deal_id");

-- HubSpot line items: tracks products attached to deals
CREATE TABLE IF NOT EXISTS "hubspot_line_items" (
  "id" SERIAL PRIMARY KEY,
  "hubspot_deal_id" VARCHAR NOT NULL,
  "hubspot_line_item_id" VARCHAR UNIQUE,
  "hubspot_product_id" VARCHAR NOT NULL,
  "product_name" VARCHAR NOT NULL,
  "quantity" INTEGER NOT NULL DEFAULT 1,
  "unit_price" NUMERIC(10, 2) NOT NULL,
  "discount_percent" INTEGER DEFAULT 0,
  "discount_reason" VARCHAR,
  "total_amount" NUMERIC(10, 2),
  "status" VARCHAR DEFAULT 'pending',
  "sync_error" TEXT,
  "created_by" VARCHAR,
  "created_by_name" VARCHAR,
  "created_at" TIMESTAMP DEFAULT NOW(),
  "updated_at" TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS "hubspot_line_items_deal_id_idx" ON "hubspot_line_items" ("hubspot_deal_id");

-- Billing audit log: tracks all billing-related changes for accountability
CREATE TABLE IF NOT EXISTS "billing_audit_log" (
  "id" SERIAL PRIMARY KEY,
  "member_email" VARCHAR NOT NULL,
  "hubspot_deal_id" VARCHAR,
  "action_type" VARCHAR NOT NULL,
  "action_details" JSONB,
  "previous_value" TEXT,
  "new_value" TEXT,
  "performed_by" VARCHAR NOT NULL,
  "performed_by_name" VARCHAR,
  "created_at" TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS "billing_audit_log_member_email_idx" ON "billing_audit_log" ("member_email");
CREATE INDEX IF NOT EXISTS "billing_audit_log_deal_id_idx" ON "billing_audit_log" ("hubspot_deal_id");

-- HubSpot form configs: caches form definitions from HubSpot for dynamic rendering
CREATE TABLE IF NOT EXISTS "hubspot_form_configs" (
  "id" SERIAL PRIMARY KEY,
  "form_type" VARCHAR NOT NULL UNIQUE,
  "hubspot_form_id" VARCHAR NOT NULL,
  "form_name" VARCHAR NOT NULL,
  "form_fields" JSONB DEFAULT '[]'::jsonb,
  "hidden_fields" JSONB DEFAULT '{}'::jsonb,
  "is_active" BOOLEAN DEFAULT true,
  "last_synced_at" TIMESTAMP,
  "created_at" TIMESTAMP DEFAULT NOW(),
  "updated_at" TIMESTAMP DEFAULT NOW()
);

-- Seed default discount rules
INSERT INTO "discount_rules" ("discount_tag", "discount_percent", "description", "is_active") VALUES
  ('Founding Member', 20, 'Early founding members receive 20% discount on membership', true),
  ('Comped', 100, 'Fully comped membership - no charge', true),
  ('Investor', 25, 'Investor discount on membership', true),
  ('Referral', 10, 'Referral program discount', true)
ON CONFLICT ("discount_tag") DO NOTHING;
