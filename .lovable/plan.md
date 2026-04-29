
## Objetivo

Corrigir 2 problemas no `whatsapp-reply-scheduler` e adicionar capacidade de reenviar mensagens que não chegaram ao WhatsApp.

---

## 1. Corrigir fluxo HUMAN HANDOFF

**Arquivo:** `supabase/functions/whatsapp-reply-scheduler/index.ts` (linhas 146‑165)

**Problema atual:** quando o cliente pede atendente humano, o código grava a mensagem no banco mesmo que o Z-API retorne 4xx/5xx — a mensagem aparece no painel mas nunca chega no WhatsApp.

**Mudança:** verificar `sendRes.ok` antes de inserir em `messages`. Se Z-API falhar, logar erro detalhado e **não gravar no banco**. Aceitar `zaapId`, `messageId` ou `id` como possíveis nomes do retorno do Z-API.

```typescript
const sendRes = await fetch(`${zapiBase}/send-text`, {...});
if (!sendRes.ok) {
  const errBody = await sendRes.text().catch(() => "");
  console.error(`[HUMAN HANDOFF FAIL] Z-API ${sendRes.status}: ${errBody}`);
  // NÃO inserir em messages
} else {
  const sendData = await sendRes.json().catch(() => ({}));
  await supabase.from("messages").insert({
    ...,
    zapi_message_id: sendData?.zaapId || sendData?.messageId || sendData?.id || null,
  });
}
```

---

## 2. Nova Edge Function: `retry-failed-messages`

**Arquivo:** `supabase/functions/retry-failed-messages/index.ts` (novo)

**O que faz:**
- Recebe `{ store_id }` no body
- Busca mensagens em `messages` com:
  - `direction = 'outbound'`
  - `source = 'ai'`
  - `zapi_message_id IS NULL`
  - `created_at >= now() - interval '6 hours'`
  - ticket com `status = 'open'` e `ai_paused = false`
- Para cada mensagem, em ordem cronológica:
  - Faz `POST` no `send-text` do Z-API com o `customer_phone` do ticket
  - Se HTTP 200: faz `UPDATE messages SET zapi_message_id = <id>` na linha original
  - Se erro: loga e mantém `zapi_message_id = null`
  - Aguarda **10 segundos** entre cada envio (anti-ban WhatsApp)
- Retorna JSON `{ total, sent, failed, errors: [...] }`

**Auth:** verifica JWT do usuário no header `Authorization` e confirma que o `store_id` pertence ao `auth.uid()` via `user_store_ids()`.

---

## 3. Botão "Reenviar mensagens com falha" no painel

**Arquivo:** `src/pages/Settings.tsx` (adicionar card no final)

**UI:**
- Card novo "Recuperação de mensagens"
- Texto explicativo: "Reenvia respostas da Sophia das últimas 6h que não chegaram ao WhatsApp (ex: durante desconexão Z-API). Espaçamento de 10s entre cada para evitar bloqueio."
- Botão "Reenviar mensagens com falha"
- Ao clicar: mostra loading com contador, chama a edge function via `supabase.functions.invoke('retry-failed-messages', { body: { store_id } })`
- Toast de sucesso/erro com totais retornados

---

## Detalhes técnicos

- A edge function precisa de timeout estendido: 6h × ~12 mensagens/h = até ~70 msgs × 10s = ~12min. Edge functions do Supabase têm limite de ~150s. **Solução:** processar no máximo 30 mensagens por chamada (≈5min); se houver mais, retornar `has_more: true` e o frontend chama de novo.
- Usar `SUPABASE_SERVICE_ROLE_KEY` na edge function para conseguir fazer `UPDATE` em messages (RLS bloquearia o usuário comum sem update policy).
- Não precisa de migration — só leitura/update em tabela existente.
- Não precisa de novo secret — Z-API creds já estão em `settings`.

---

## Arquivos alterados

- `supabase/functions/whatsapp-reply-scheduler/index.ts` — fix linhas 146‑165
- `supabase/functions/retry-failed-messages/index.ts` — novo
- `src/pages/Settings.tsx` — adicionar card + botão
