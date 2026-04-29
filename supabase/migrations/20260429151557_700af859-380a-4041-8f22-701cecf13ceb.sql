
-- Marcar como skipped os 2 itens travados há 12 dias em "processing"
UPDATE public.auto_reply_queue
SET status = 'skipped'
WHERE status = 'processing'
  AND scheduled_for < now() - interval '1 hour';

-- Re-enfileirar tickets abertos cujas últimas mensagens são do cliente (inbound) nas últimas 3h
INSERT INTO public.auto_reply_queue (ticket_id, store_id, status, scheduled_for, message_count, pending_since, created_at)
SELECT t.id, t.store_id, 'pending', now() + (row_number() OVER (ORDER BY t.last_message_at) * interval '3 seconds'), 1, now(), now()
FROM public.tickets t
WHERE t.status = 'open'
  AND t.ai_paused = false
  AND t.last_message_at > now() - interval '3 hours'
  AND (
    SELECT direction FROM public.messages m
    WHERE m.ticket_id = t.id
    ORDER BY created_at DESC LIMIT 1
  ) = 'inbound'
  AND NOT EXISTS (
    SELECT 1 FROM public.auto_reply_queue q
    WHERE q.ticket_id = t.id AND q.status = 'pending'
  );
