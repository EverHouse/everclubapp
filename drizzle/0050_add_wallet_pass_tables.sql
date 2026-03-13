CREATE TABLE IF NOT EXISTS "wallet_pass_auth_tokens" (
  "id" serial PRIMARY KEY,
  "serial_number" varchar NOT NULL UNIQUE,
  "auth_token" varchar NOT NULL,
  "member_id" varchar NOT NULL,
  "created_at" timestamp DEFAULT now(),
  "updated_at" timestamp DEFAULT now()
);

CREATE TABLE IF NOT EXISTS "wallet_pass_device_registrations" (
  "id" serial PRIMARY KEY,
  "device_library_id" varchar NOT NULL,
  "push_token" varchar NOT NULL,
  "pass_type_id" varchar NOT NULL,
  "serial_number" varchar NOT NULL,
  "created_at" timestamp DEFAULT now(),
  "updated_at" timestamp DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS "wallet_pass_device_serial_idx" ON "wallet_pass_device_registrations" ("device_library_id", "pass_type_id", "serial_number");
CREATE INDEX IF NOT EXISTS "wallet_pass_serial_idx" ON "wallet_pass_device_registrations" ("serial_number");
CREATE INDEX IF NOT EXISTS "wallet_pass_auth_member_idx" ON "wallet_pass_auth_tokens" ("member_id");
