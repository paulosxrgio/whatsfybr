CREATE TABLE IF NOT EXISTS public.supervisor_reports (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  store_id uuid NOT NULL,
  date date NOT NULL DEFAULT CURRENT_DATE,
  tickets_analyzed int DEFAULT 0,
  score numeric,
  critical_errors jsonb DEFAULT '[]'::jsonb,
  patterns_found jsonb DEFAULT '[]'::jsonb,
  prompt_additions jsonb DEFAULT '[]'::jsonb,
  summary text,
  created_at timestamptz DEFAULT now()
);

ALTER TABLE public.supervisor_reports ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users manage own store supervisor reports"
ON public.supervisor_reports
FOR ALL
USING (store_id IN (SELECT public.user_store_ids()))
WITH CHECK (store_id IN (SELECT public.user_store_ids()));

CREATE INDEX IF NOT EXISTS idx_supervisor_reports_store_date
ON public.supervisor_reports(store_id, date DESC);