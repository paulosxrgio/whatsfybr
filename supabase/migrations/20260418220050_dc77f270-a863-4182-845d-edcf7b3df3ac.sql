-- Adicionar colunas que faltam na tabela requests
ALTER TABLE public.requests ADD COLUMN IF NOT EXISTS order_id text;
ALTER TABLE public.requests ADD COLUMN IF NOT EXISTS order_name text;
ALTER TABLE public.requests ADD COLUMN IF NOT EXISTS updated_at timestamptz DEFAULT now();

-- Índices para consultas no painel
CREATE INDEX IF NOT EXISTS idx_requests_ticket_status ON public.requests(ticket_id, status);
CREATE INDEX IF NOT EXISTS idx_requests_store_status ON public.requests(store_id, status);

-- Realtime
ALTER TABLE public.requests REPLICA IDENTITY FULL;
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND tablename = 'requests'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.requests;
  END IF;
END $$;