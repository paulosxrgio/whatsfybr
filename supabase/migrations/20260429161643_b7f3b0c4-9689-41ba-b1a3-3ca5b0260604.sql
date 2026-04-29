ALTER TABLE public.tickets
ADD COLUMN IF NOT EXISTS customer_lid text;

ALTER TABLE public.messages
ADD COLUMN IF NOT EXISTS chat_lid text;

CREATE INDEX IF NOT EXISTS idx_tickets_customer_lid ON public.tickets(customer_lid);
CREATE INDEX IF NOT EXISTS idx_messages_chat_lid ON public.messages(chat_lid);