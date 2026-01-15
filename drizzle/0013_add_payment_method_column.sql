-- Add payment_method column to booking_payment_audit for proper reconciliation tracking
ALTER TABLE booking_payment_audit 
ADD COLUMN IF NOT EXISTS payment_method VARCHAR;
