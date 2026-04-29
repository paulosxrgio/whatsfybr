-- Remove duplicidades ativas antigas, mantendo apenas o item mais antigo por ticket
WITH ranked AS (
  SELECT
    id,
    ROW_NUMBER() OVER (
      PARTITION BY ticket_id
      ORDER BY scheduled_for ASC, created_at ASC
    ) AS rn
  FROM public.recovery_reply_queue
  WHERE status IN ('pending', 'processing')
)
DELETE FROM public.recovery_reply_queue q
USING ranked r
WHERE q.id = r.id
  AND r.rn > 1;

-- Evita novos itens ativos duplicados para o mesmo ticket
CREATE UNIQUE INDEX IF NOT EXISTS idx_recovery_queue_one_active_per_ticket
  ON public.recovery_reply_queue (ticket_id)
  WHERE status IN ('pending', 'processing');

-- Acelera buscas da retomada: última mensagem e respostas confirmadas por loja/ticket
CREATE INDEX IF NOT EXISTS idx_messages_store_ticket_created_direction
  ON public.messages (store_id, ticket_id, created_at DESC, direction);

CREATE INDEX IF NOT EXISTS idx_messages_recent_confirmed_outbound
  ON public.messages (store_id, ticket_id, created_at DESC)
  WHERE direction = 'outbound'
    AND delivery_status IN ('sent', 'delivered', 'received', 'read');