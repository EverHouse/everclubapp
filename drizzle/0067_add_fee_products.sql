CREATE TABLE IF NOT EXISTS "fee_products" (
        "id" serial PRIMARY KEY NOT NULL,
        "name" varchar NOT NULL,
        "slug" varchar NOT NULL,
        "description" text,
        "price_cents" integer DEFAULT 0,
        "price_string" varchar NOT NULL,
        "button_text" varchar DEFAULT 'Purchase',
        "stripe_product_id" varchar,
        "stripe_price_id" varchar,
        "product_type" varchar DEFAULT 'one_time',
        "fee_type" varchar,
        "is_active" boolean DEFAULT true,
        "sort_order" integer DEFAULT 0,
        "created_at" timestamp DEFAULT now(),
        "updated_at" timestamp DEFAULT now(),
        CONSTRAINT "fee_products_name_unique" UNIQUE("name"),
        CONSTRAINT "fee_products_slug_unique" UNIQUE("slug")
);

INSERT INTO fee_products (name, slug, description, price_cents, price_string, button_text,
  stripe_product_id, stripe_price_id, product_type,
  fee_type, is_active, sort_order, created_at, updated_at)
SELECT name, slug, description, price_cents, price_string,
  COALESCE(button_text, 'Purchase'),
  stripe_product_id, stripe_price_id, product_type,
  CASE
    WHEN slug = 'guest-pass' THEN 'guest_pass'
    WHEN slug = 'simulator-overage-30min' THEN 'simulator_overage'
    WHEN slug = 'day-pass-coworking' THEN 'day_pass_coworking'
    WHEN slug = 'day-pass-golf-sim' THEN 'day_pass_golf_sim'
    WHEN slug = 'corporate-volume-pricing' THEN 'corporate_config'
    ELSE 'general'
  END,
  is_active, sort_order, created_at, updated_at
FROM membership_tiers
WHERE product_type IN ('one_time', 'fee', 'config')
ON CONFLICT (slug) DO NOTHING;

UPDATE membership_tiers
SET is_active = false,
    stripe_product_id = NULL,
    stripe_price_id = NULL,
    updated_at = NOW()
WHERE product_type IN ('one_time', 'fee', 'config')
  AND is_active = true;
