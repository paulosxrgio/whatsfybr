
UPDATE auto_reply_queue
SET status = 'failed'
WHERE status = 'pending'
AND created_at < NOW() - INTERVAL '5 minutes';
