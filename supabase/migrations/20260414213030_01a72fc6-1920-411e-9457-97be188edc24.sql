
CREATE TABLE public.whatsapp_notifications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id uuid NOT NULL,
  shopify_order_id text NOT NULL,
  order_number text,
  customer_name text,
  customer_phone text NOT NULL,
  event_type text NOT NULL DEFAULT 'order_fulfilled',
  tracking_code text,
  tracking_url text,
  carrier text,
  message_content text,
  status text NOT NULL DEFAULT 'pending',
  error_message text,
  sent_at timestamptz,
  created_at timestamptz DEFAULT now(),
  UNIQUE(store_id, shopify_order_id, event_type)
);

ALTER TABLE public.whatsapp_notifications ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users manage own store notifications"
  ON public.whatsapp_notifications FOR ALL
  USING (store_id IN (SELECT user_store_ids()))
  WITH CHECK (store_id IN (SELECT user_store_ids()));

ALTER TABLE public.settings ADD COLUMN IF NOT EXISTS notify_order_fulfilled boolean DEFAULT false;
