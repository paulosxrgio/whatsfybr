ALTER TABLE public.messages
ADD COLUMN IF NOT EXISTS zapi_zaap_id TEXT,
ADD COLUMN IF NOT EXISTS zapi_id TEXT,
ADD COLUMN IF NOT EXISTS zapi_response JSONB,
ADD COLUMN IF NOT EXISTS delivery_callback_payload JSONB,
ADD COLUMN IF NOT EXISTS delivery_status TEXT DEFAULT 'received',
ADD COLUMN IF NOT EXISTS delivery_error TEXT,
ADD COLUMN IF NOT EXISTS delivery_updated_at TIMESTAMP WITH TIME ZONE;

CREATE INDEX IF NOT EXISTS idx_messages_zapi_message_id ON public.messages (zapi_message_id);
CREATE INDEX IF NOT EXISTS idx_messages_zapi_zaap_id ON public.messages (zapi_zaap_id);
CREATE INDEX IF NOT EXISTS idx_messages_zapi_id ON public.messages (zapi_id);
CREATE INDEX IF NOT EXISTS idx_messages_delivery_status ON public.messages (delivery_status);