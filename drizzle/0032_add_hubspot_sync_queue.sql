CREATE TABLE hubspot_sync_queue (
  id serial PRIMARY KEY,
  operation varchar(100) NOT NULL,  -- e.g., 'create_contact', 'update_contact', 'create_deal', 'sync_member'
  payload jsonb NOT NULL,           -- Operation-specific data
  status varchar(50) DEFAULT 'pending', -- pending, processing, completed, failed, dead
  priority integer DEFAULT 5,       -- 1 (highest) to 10 (lowest)
  retry_count integer DEFAULT 0,
  max_retries integer DEFAULT 5,
  last_error text,
  next_retry_at timestamp,
  created_at timestamp DEFAULT now(),
  updated_at timestamp DEFAULT now(),
  completed_at timestamp,
  idempotency_key varchar(255)      -- Prevent duplicate operations
);

CREATE INDEX hubspot_sync_queue_status_priority_idx ON hubspot_sync_queue (status, priority, created_at) 
WHERE status IN ('pending', 'failed');

CREATE INDEX hubspot_sync_queue_next_retry_idx ON hubspot_sync_queue (next_retry_at) 
WHERE status = 'failed';

CREATE UNIQUE INDEX hubspot_sync_queue_idempotency_idx ON hubspot_sync_queue (idempotency_key) 
WHERE idempotency_key IS NOT NULL AND status != 'completed';
