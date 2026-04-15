
-- 1. Close duplicate open tickets (keep most recent per store+phone)
UPDATE tickets t1
SET status = 'closed'
WHERE status = 'open'
AND id NOT IN (
  SELECT DISTINCT ON (store_id, customer_phone) id
  FROM tickets
  WHERE status = 'open'
  ORDER BY store_id, customer_phone, created_at DESC
);

-- 2. Partial unique index to prevent race condition duplicates
CREATE UNIQUE INDEX idx_one_open_ticket_per_phone_store
ON tickets (store_id, customer_phone)
WHERE status = 'open';

-- 3. Clean old failed queue entries
DELETE FROM auto_reply_queue WHERE status = 'failed';
