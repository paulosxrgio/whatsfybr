
-- 1. Create tables first

CREATE TABLE public.stores (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  name text NOT NULL,
  created_at timestamptz DEFAULT now()
);

CREATE TABLE public.settings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id uuid REFERENCES public.stores(id) ON DELETE CASCADE UNIQUE NOT NULL,
  zapi_instance_id text,
  zapi_token text,
  zapi_client_token text,
  ai_provider text DEFAULT 'openai',
  openai_api_key text,
  anthropic_api_key text,
  ai_model text DEFAULT 'gpt-4o',
  ai_system_prompt text,
  ai_is_active boolean DEFAULT true,
  ai_response_delay integer DEFAULT 2,
  shopify_store_url text,
  shopify_client_id text,
  shopify_client_secret text,
  created_at timestamptz DEFAULT now()
);

CREATE TABLE public.tickets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id uuid REFERENCES public.stores(id) ON DELETE CASCADE NOT NULL,
  customer_name text,
  customer_phone text NOT NULL,
  status text DEFAULT 'open',
  sentiment text DEFAULT 'neutral',
  last_message_at timestamptz DEFAULT now(),
  created_at timestamptz DEFAULT now()
);

CREATE TABLE public.messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ticket_id uuid REFERENCES public.tickets(id) ON DELETE CASCADE NOT NULL,
  store_id uuid REFERENCES public.stores(id) ON DELETE CASCADE NOT NULL,
  content text,
  direction text NOT NULL,
  message_type text DEFAULT 'text',
  media_url text,
  zapi_message_id text,
  created_at timestamptz DEFAULT now()
);

CREATE TABLE public.auto_reply_queue (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ticket_id uuid REFERENCES public.tickets(id) ON DELETE CASCADE NOT NULL,
  store_id uuid REFERENCES public.stores(id) ON DELETE CASCADE NOT NULL,
  status text DEFAULT 'pending',
  scheduled_for timestamptz DEFAULT now(),
  created_at timestamptz DEFAULT now()
);

CREATE TABLE public.customer_memory (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id uuid REFERENCES public.stores(id) ON DELETE CASCADE NOT NULL,
  customer_phone text NOT NULL,
  customer_name text,
  preferred_language text DEFAULT 'Portuguese',
  last_sentiment text,
  total_interactions integer DEFAULT 0,
  notes text,
  updated_at timestamptz DEFAULT now(),
  UNIQUE(store_id, customer_phone)
);

CREATE TABLE public.requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ticket_id uuid REFERENCES public.tickets(id) ON DELETE CASCADE NOT NULL,
  store_id uuid REFERENCES public.stores(id) ON DELETE CASCADE NOT NULL,
  customer_name text,
  customer_phone text,
  type text,
  description text,
  details jsonb,
  status text DEFAULT 'pending',
  created_at timestamptz DEFAULT now()
);

CREATE TYPE public.app_role AS ENUM ('admin', 'moderator', 'user');

CREATE TABLE public.user_roles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  role app_role NOT NULL,
  UNIQUE(user_id, role)
);

-- 2. Helper functions (tables exist now)

CREATE OR REPLACE FUNCTION public.user_store_ids()
RETURNS SETOF uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT id FROM public.stores WHERE user_id = auth.uid()
$$;

CREATE OR REPLACE FUNCTION public.has_role(_user_id uuid, _role app_role)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.user_roles WHERE user_id = _user_id AND role = _role
  )
$$;

-- 3. Enable RLS on all tables
ALTER TABLE public.stores ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tickets ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.auto_reply_queue ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.customer_memory ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_roles ENABLE ROW LEVEL SECURITY;

-- 4. RLS Policies
CREATE POLICY "Users manage own stores" ON public.stores FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users manage own store settings" ON public.settings FOR ALL USING (store_id IN (SELECT public.user_store_ids())) WITH CHECK (store_id IN (SELECT public.user_store_ids()));
CREATE POLICY "Users manage own store tickets" ON public.tickets FOR ALL USING (store_id IN (SELECT public.user_store_ids())) WITH CHECK (store_id IN (SELECT public.user_store_ids()));
CREATE POLICY "Users manage own store messages" ON public.messages FOR ALL USING (store_id IN (SELECT public.user_store_ids())) WITH CHECK (store_id IN (SELECT public.user_store_ids()));
CREATE POLICY "Users manage own store queue" ON public.auto_reply_queue FOR ALL USING (store_id IN (SELECT public.user_store_ids())) WITH CHECK (store_id IN (SELECT public.user_store_ids()));
CREATE POLICY "Users manage own store memory" ON public.customer_memory FOR ALL USING (store_id IN (SELECT public.user_store_ids())) WITH CHECK (store_id IN (SELECT public.user_store_ids()));
CREATE POLICY "Users manage own store requests" ON public.requests FOR ALL USING (store_id IN (SELECT public.user_store_ids())) WITH CHECK (store_id IN (SELECT public.user_store_ids()));
CREATE POLICY "Users can view own roles" ON public.user_roles FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Admins manage roles" ON public.user_roles FOR ALL USING (public.has_role(auth.uid(), 'admin')) WITH CHECK (public.has_role(auth.uid(), 'admin'));

-- 5. Indexes
CREATE INDEX idx_tickets_store_status ON public.tickets(store_id, status);
CREATE INDEX idx_tickets_phone ON public.tickets(store_id, customer_phone);
CREATE INDEX idx_messages_ticket ON public.messages(ticket_id, created_at);
CREATE INDEX idx_queue_status ON public.auto_reply_queue(status, scheduled_for);
CREATE INDEX idx_customer_memory_phone ON public.customer_memory(store_id, customer_phone);
CREATE INDEX idx_requests_store ON public.requests(store_id, status);
