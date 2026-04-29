
## Objetivo

Replicar a arquitetura do Zaply (que funciona) no projeto atual, mantendo o schema (`tickets`, `store_id`, `auto_reply_queue`). Hoje o envio falha porque foram acumuladas camadas extras: checagem de `/status` antes de enviar, conversão para `@lid`, helper compartilhado e múltiplos pontos enviando direto para a Z-API. Vamos simplificar tudo seguindo o padrão do Zaply.

## Mapeamento Zaply → Projeto

| Zaply | Projeto |
|---|---|
| `process-inbound-wa` | `process-inbound-whatsapp` |
| `wa-reply-scheduler` | `whatsapp-reply-scheduler` |
| `send-whatsapp-reply` | `send-whatsapp-reply` |
| `conversations` / `conversation_id` | `tickets` / `ticket_id` |
| `reply_queue` | `auto_reply_queue` |
| `user_id` em `settings` | `store_id` em `settings` |
| `messages.sent_at` | `messages.created_at` |
| `phone` em conversation | `customer_phone` em ticket |

UI, sidebar, cores, design não mudam. Só edge functions e (se necessário) ajuste pequeno em `Tickets.tsx` no retorno.

## Arquivos a alterar

1. `supabase/functions/send-whatsapp-reply/index.ts` — reescrever no padrão Zaply (única função que envia).
2. `supabase/functions/whatsapp-reply-scheduler/index.ts` — reescrever no padrão Zaply (lock por delete, gera resposta, chama `send-whatsapp-reply`, NÃO insere outbound nem chama Z-API direto).
3. `supabase/functions/process-inbound-whatsapp/index.ts` — simplificar: filtrar callbacks, idempotência por `messageId`, upsert de ticket, salvar inbound, agendar fila.
4. `supabase/functions/_shared/zapi.ts` — remover (deixa de ser usado pelo fluxo de cliente).
5. `supabase/functions/retry-failed-messages/index.ts` — passar a chamar `send-whatsapp-reply` em vez de bater na Z-API direto.
6. `supabase/functions/supervisor-agent/index.ts` — manter envio direto SOMENTE para alerta interno do operador (553388756885), claramente isolado.
7. `src/pages/Tickets.tsx` — manter, só ajustar leitura de `data.ok` se necessário (sem mexer em layout).

## Detalhes técnicos

### `send-whatsapp-reply` (única porta de saída)

Aceita payload:
```
{ ticket_id, store_id, message, source: "manual" | "ai" }
```

Fluxo:
- Buscar `ticket` por `id` + `store_id` (service role) → pega `customer_phone`.
- Buscar `settings` por `store_id` → `zapi_instance_id`, `zapi_token`, `zapi_client_token`.
- `cleanPhone = customer_phone.replace(/\D/g, "")`.
- POST para `https://api.z-api.io/instances/{id}/token/{tk}/send-text` com headers `Content-Type: application/json` + `Client-Token`. Body **exatamente** `{ phone, message }`.
- Sem `/status`, sem `@lid`, sem helper.
- Se HTTP OK: `INSERT` em `messages` outbound com `zapi_message_id = messageId || id || zaapId`, `zapi_zaap_id`, `zapi_id`, `zapi_response`, `delivery_status='sent_to_zapi'`. `UPDATE tickets.last_message_at`.
- Se HTTP não OK: retornar `{ ok:false, error, http_status, body }` (status 200 para frontend tratar).
- Logs: `[SEND-WHATSAPP-REPLY INPUT]`, `[ZAPI CREDENTIAL CHECK]`, `[ZAPI SEND REQUEST]`, `[ZAPI SEND RESPONSE]`, `[MESSAGE SAVED]`.

### `whatsapp-reply-scheduler` (padrão Zaply)

- Buscar `auto_reply_queue` `status='pending'` e `scheduled_for <= now()`, limit 20.
- Lock: `DELETE` por `id` retornando rows; se nenhuma linha, pular (substitui o esquema atual de `processing`).
- Para cada item: carregar ticket, settings, histórico (40 últimas), training_examples.
- Pular se `ai_is_active=false` ou `ticket.ai_paused=true` ou ticket fechado.
- Gerar resposta via OpenAI (manter modelo/prompt já existentes).
- Chamar `send-whatsapp-reply` via `fetch` para `${SUPABASE_URL}/functions/v1/send-whatsapp-reply` com `Authorization: Bearer ${SERVICE_ROLE}` e body `{ ticket_id, store_id, message, source:"ai" }`.
- **Não** inserir outbound aqui. **Não** chamar Z-API direto aqui.
- Logs: `[SCHEDULER] Processando X itens`, `[SCHEDULER ITEM]`, `[SCHEDULER HISTORY]`, `[SCHEDULER AI RESPONSE GENERATED]`, `[SCHEDULER CALL SEND-WHATSAPP-REPLY]`, `[SCHEDULER SEND RESULT]`.

### `process-inbound-whatsapp`

- Filtrar `MessageStatusCallback`, `DeliveryCallback`, `PresenceChatCallback`, `ChatPresenceCallback`, `MessageSendStatusCallback`, `ConnectedCallback`, `DisconnectedCallback` → retornar `{ ok:true, skipped }`.
- Filtrar `fromMe`, `fromApi`, `isGroup`, `isNewsletter`.
- Rejeitar phone vazio, `0`, contendo `@lid`, `@broadcast`, `status@`.
- Exigir `messageId`; idempotência por `messages.zapi_message_id`.
- Buscar/criar ticket por `(store_id, customer_phone, status='open')`.
- Salvar inbound em `messages` (`source='whatsapp'`, `chat_lid` se presente).
- Manter Vision/Whisper já existentes.
- Atualizar `tickets.last_message_at`.
- `auto_reply_queue` via RPC `upsert_reply_queue` existente, com `delay = settings.ai_response_delay ?? 45`.
- Logs: `[INBOUND RECEIVED]`, `[INBOUND SKIPPED]`, `[INBOUND TICKET UPSERTED]`, `[INBOUND MESSAGE SAVED]`, `[AUTO REPLY QUEUE UPSERTED]`.

### Limpeza de envios diretos

Após mudança, `rg "api.z-api.io|send-text|send-image|send-document"` deve mostrar Z-API direta apenas em:
- `send-whatsapp-reply` (oficial)
- `supervisor-agent` (alerta interno, isolado)
- `verify-zapi`/`diagnostic` (se existir, para teste de credencial)

`retry-failed-messages` passa a invocar `send-whatsapp-reply`.

## Teste obrigatório após implementação

1. Deploy das 3 funções via `deploy_edge_functions`.
2. Disparar `send-whatsapp-reply` via `curl_edge_functions` com um ticket real (Paulo, 553388756885) e mensagem curta.
3. Capturar logs `[ZAPI SEND RESPONSE]` e o `DeliveryCallback` em `process-inbound-whatsapp`.
4. Confirmar `delivery_status='sent'` (não `failed`) na tabela `messages`.
5. Confirmar visualmente no WhatsApp do destinatário (usuário precisa confirmar — não temos acesso ao WhatsApp dele).

## Entrega

Ao final mostro: arquivos alterados, partes copiadas/adaptadas do Zaply, mapeamento usado, lista completa de pontos onde havia chamada direta à Z-API, confirmação de fluxo único, logs do teste real e resposta da Z-API.
