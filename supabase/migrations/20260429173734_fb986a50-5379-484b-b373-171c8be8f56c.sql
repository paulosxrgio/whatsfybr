-- Restringe execução de funções internas SECURITY DEFINER
REVOKE EXECUTE ON FUNCTION public.has_role(uuid, app_role) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.user_store_ids() FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.upsert_reply_queue(uuid, uuid, timestamp with time zone) FROM PUBLIC, anon, authenticated;

-- user_store_ids é usada pelas políticas de acesso de usuários autenticados
GRANT EXECUTE ON FUNCTION public.user_store_ids() TO authenticated;

-- upsert_reply_queue é chamada apenas pelo backend com chave de serviço
GRANT EXECUTE ON FUNCTION public.upsert_reply_queue(uuid, uuid, timestamp with time zone) TO service_role;