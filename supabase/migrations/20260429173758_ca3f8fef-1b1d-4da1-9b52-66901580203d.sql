CREATE OR REPLACE FUNCTION public.user_store_ids()
RETURNS SETOF uuid
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
  SELECT id FROM public.stores WHERE user_id = auth.uid()
$$;

GRANT EXECUTE ON FUNCTION public.user_store_ids() TO authenticated;