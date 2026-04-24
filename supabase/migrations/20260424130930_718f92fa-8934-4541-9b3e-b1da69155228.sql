ALTER TABLE public.settings
  ADD COLUMN IF NOT EXISTS cerebro_corpus_knowledge text,
  ADD COLUMN IF NOT EXISTS corpus_analyzed_at timestamptz,
  ADD COLUMN IF NOT EXISTS corpus_pairs_analyzed integer DEFAULT 0;