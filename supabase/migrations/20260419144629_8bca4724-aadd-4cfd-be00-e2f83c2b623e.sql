-- 1. Função para upsert atômico da fila de auto-reply
CREATE OR REPLACE FUNCTION public.upsert_reply_queue(
  p_ticket_id uuid,
  p_store_id uuid,
  p_scheduled_for timestamptz
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE public.auto_reply_queue
  SET
    scheduled_for = p_scheduled_for,
    message_count = COALESCE(message_count, 1) + 1,
    pending_since = now()
  WHERE ticket_id = p_ticket_id
    AND status = 'pending';

  IF NOT FOUND THEN
    INSERT INTO public.auto_reply_queue (ticket_id, store_id, status, scheduled_for, message_count, pending_since, created_at)
    VALUES (p_ticket_id, p_store_id, 'pending', p_scheduled_for, 1, now(), now());
  END IF;
END;
$$;

-- 2. Garantir colunas/tabelas que podem estar faltando (idempotente)
ALTER TABLE public.tickets ADD COLUMN IF NOT EXISTS ai_paused boolean DEFAULT false;
ALTER TABLE public.tickets ADD COLUMN IF NOT EXISTS ai_paused_at timestamptz;
ALTER TABLE public.messages ADD COLUMN IF NOT EXISTS source text DEFAULT 'ai';
ALTER TABLE public.customer_memory ADD COLUMN IF NOT EXISTS customer_email text;
ALTER TABLE public.requests ADD COLUMN IF NOT EXISTS details jsonb;

-- training_examples e supervisor_reports já existem com RLS — IF NOT EXISTS garante idempotência
CREATE TABLE IF NOT EXISTS public.training_examples (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  store_id uuid NOT NULL,
  ticket_id uuid,
  customer_input text,
  ideal_response text NOT NULL,
  source text DEFAULT 'human_operator',
  applied boolean DEFAULT false,
  created_at timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.supervisor_reports (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  store_id uuid NOT NULL,
  date date DEFAULT CURRENT_DATE,
  tickets_analyzed int DEFAULT 0,
  score numeric,
  critical_errors jsonb DEFAULT '[]'::jsonb,
  patterns_found jsonb DEFAULT '[]'::jsonb,
  prompt_additions jsonb DEFAULT '[]'::jsonb,
  summary text,
  created_at timestamptz DEFAULT now()
);

ALTER TABLE public.training_examples ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.supervisor_reports ENABLE ROW LEVEL SECURITY;