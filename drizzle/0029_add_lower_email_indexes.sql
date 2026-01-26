-- Add functional indexes for case-insensitive email lookups
CREATE INDEX IF NOT EXISTS idx_users_lower_email ON users (LOWER(email));
CREATE INDEX IF NOT EXISTS idx_booking_requests_lower_email ON booking_requests (LOWER(user_email));
CREATE INDEX IF NOT EXISTS idx_booking_participants_lower_email ON booking_participants (LOWER(user_id));
CREATE INDEX IF NOT EXISTS idx_guest_passes_lower_email ON guest_passes (LOWER(member_email));
