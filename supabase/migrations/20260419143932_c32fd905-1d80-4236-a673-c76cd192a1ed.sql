ALTER TABLE public.tickets ADD COLUMN IF NOT EXISTS ai_paused boolean DEFAULT false;
ALTER TABLE public.tickets ADD COLUMN IF NOT EXISTS ai_paused_at timestamptz;
ALTER TABLE public.messages ADD COLUMN IF NOT EXISTS source text DEFAULT 'ai';

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

ALTER TABLE public.training_examples ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users manage own store training"
  ON public.training_examples
  FOR ALL
  USING (store_id IN (SELECT public.user_store_ids()))
  WITH CHECK (store_id IN (SELECT public.user_store_ids()));

CREATE INDEX IF NOT EXISTS idx_training_store_created ON public.training_examples(store_id, created_at DESC);