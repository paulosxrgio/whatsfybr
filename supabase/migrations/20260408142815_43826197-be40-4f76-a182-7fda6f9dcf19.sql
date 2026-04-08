CREATE TABLE public.account_settings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL UNIQUE,
  ai_provider text DEFAULT 'openai',
  openai_api_key text,
  anthropic_api_key text,
  ai_model text DEFAULT 'gpt-4o',
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

ALTER TABLE public.account_settings ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users manage own account settings"
ON public.account_settings FOR ALL
USING (auth.uid() = user_id)
WITH CHECK (auth.uid() = user_id);