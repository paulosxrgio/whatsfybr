
CREATE TABLE IF NOT EXISTS public.recovery_reply_queue (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  ticket_id UUID NOT NULL,
  store_id UUID NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  scheduled_for TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  attempts INTEGER NOT NULL DEFAULT 0,
  last_error TEXT,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_recovery_queue_pending
  ON public.recovery_reply_queue (status, scheduled_for);
CREATE INDEX IF NOT EXISTS idx_recovery_queue_ticket
  ON public.recovery_reply_queue (ticket_id);

ALTER TABLE public.recovery_reply_queue ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users manage own store recovery queue"
ON public.recovery_reply_queue
FOR ALL
USING (store_id IN (SELECT user_store_ids()))
WITH CHECK (store_id IN (SELECT user_store_ids()));

ALTER TABLE public.tickets
  ADD COLUMN IF NOT EXISTS recovery_message_sent_at TIMESTAMP WITH TIME ZONE;
