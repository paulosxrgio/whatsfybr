
-- 1. Limpar fila travada (pending antigos > 1h e processing > 10min)
UPDATE auto_reply_queue
SET status = 'failed'
WHERE status = 'pending'
AND scheduled_for < NOW() - INTERVAL '1 hour';

UPDATE auto_reply_queue
SET status = 'failed'
WHERE status = 'processing'
AND created_at < NOW() - INTERVAL '10 minutes';

-- 2. Garantir cron ativo do scheduler (recriar se necessário)
SELECT cron.unschedule('whatsapp-reply-scheduler')
WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'whatsapp-reply-scheduler');

SELECT cron.schedule(
  'whatsapp-reply-scheduler',
  '* * * * *',
  $$
  SELECT net.http_post(
    url := 'https://tkfacslgbllqzjeotzrd.supabase.co/functions/v1/whatsapp-reply-scheduler',
    headers := jsonb_build_object(
      'Authorization', 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InRrZmFjc2xnYmxscXpqZW90enJkIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzU1OTgyNjMsImV4cCI6MjA5MTE3NDI2M30.e-cGl8-DtFv0DgvR-15DcqsLLkswz-99DBKCWnlEm1Y',
      'Content-Type', 'application/json'
    ),
    body := '{}'::jsonb
  )
  $$
);
