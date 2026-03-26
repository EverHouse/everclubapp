CREATE TABLE IF NOT EXISTS "merch_items" (
        "id" serial PRIMARY KEY NOT NULL,
        "name" varchar NOT NULL,
        "price" numeric DEFAULT '0' NOT NULL,
        "description" text,
        "type" varchar DEFAULT 'Apparel' NOT NULL,
        "icon" varchar,
        "image_url" text,
        "is_active" boolean DEFAULT true,
        "sort_order" integer DEFAULT 0,
        "stock_quantity" integer,
        "stripe_product_id" varchar,
        "stripe_price_id" varchar,
        "created_at" timestamp DEFAULT now()
);
