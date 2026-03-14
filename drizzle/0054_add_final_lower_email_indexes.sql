-- Final LOWER(email) indexes for tables queried with LOWER() in admin cleanup,
-- visitor deletion, user merge, and subscription flows

-- trackman_unmatched_bookings — admin delete + visitor cleanup
CREATE INDEX IF NOT EXISTS "idx_trackman_unmatched_lower_original_email" ON "trackman_unmatched_bookings" (LOWER("original_email"));
CREATE INDEX IF NOT EXISTS "idx_trackman_unmatched_lower_resolved_email" ON "trackman_unmatched_bookings" (LOWER("resolved_email"));

-- trackman_bay_slots — admin delete + visitor cleanup
CREATE INDEX IF NOT EXISTS "idx_trackman_bay_slots_lower_customer_email" ON "trackman_bay_slots" (LOWER("customer_email"));

-- terminal_payments — admin delete + visitor cleanup
CREATE INDEX IF NOT EXISTS "idx_terminal_payments_lower_user_email" ON "terminal_payments" (LOWER("user_email"));

-- stripe_transaction_cache — admin delete + visitor cleanup (no Drizzle schema)
CREATE INDEX IF NOT EXISTS "idx_stripe_tx_cache_lower_customer_email" ON "stripe_transaction_cache" (LOWER("customer_email"));

-- sync_exclusions — subscription check (no Drizzle schema)
CREATE INDEX IF NOT EXISTS "idx_sync_exclusions_lower_email" ON "sync_exclusions" (LOWER("email"));

-- hubspot_sync_queue — admin delete + visitor cleanup, JSONB expression (no Drizzle schema)
CREATE INDEX IF NOT EXISTS "idx_hubspot_sync_queue_lower_email" ON "hubspot_sync_queue" (LOWER("payload"->>'email'));
