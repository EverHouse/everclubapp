-- Passkeys table for WebAuthn biometric authentication (Face ID / Touch ID)
CREATE TABLE IF NOT EXISTS "passkeys" (
  "id" serial PRIMARY KEY NOT NULL,
  "user_id" varchar NOT NULL,
  "credential_id" text NOT NULL,
  "public_key" text NOT NULL,
  "counter" integer DEFAULT 0 NOT NULL,
  "transports" jsonb DEFAULT '[]'::jsonb,
  "device_name" varchar,
  "created_at" timestamp DEFAULT now(),
  "last_used_at" timestamp,
  CONSTRAINT "passkeys_credential_id_unique" UNIQUE("credential_id")
);

CREATE INDEX IF NOT EXISTS "idx_passkeys_user_id" ON "passkeys" ("user_id");
