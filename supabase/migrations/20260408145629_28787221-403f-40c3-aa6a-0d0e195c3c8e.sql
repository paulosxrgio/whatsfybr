ALTER TABLE public.auto_reply_queue
ADD COLUMN IF NOT EXISTS pending_since timestamptz DEFAULT now(),
ADD COLUMN IF NOT EXISTS message_count integer DEFAULT 1;