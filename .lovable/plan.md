

# Production Readiness — Suportfy WhatsApp

## Overview
7 changes to make the system production-ready: Realtime, CRON scheduler, enhanced customer sidebar, ticket close/reopen, Z-API connection verification, webhook setup instructions, and typing indicator.

---

## 1. Enable Realtime on tables

**Migration SQL:**
```sql
ALTER PUBLICATION supabase_realtime ADD TABLE tickets;
ALTER PUBLICATION supabase_realtime ADD TABLE messages;
```

The Tickets page already has realtime subscriptions in place — no frontend changes needed for this step.

## 2. CRON Scheduler via pg_cron

Enable `pg_cron` and `pg_net` extensions via migration, then use the **insert tool** (not migration) to schedule the job:

```sql
CREATE EXTENSION IF NOT EXISTS pg_cron WITH SCHEMA extensions;
CREATE EXTENSION IF NOT EXISTS pg_net WITH SCHEMA extensions;
```

Then insert the cron job calling `whatsapp-reply-scheduler` every minute using the project's URL and anon key.

## 3. Enhanced Customer Sidebar (Tickets page)

Expand the right panel to fetch and display `customer_memory` data:
- Total interactions count
- Last sentiment with emoji
- Customer notes
- Preferred language
- "Pedidos Shopify" section (placeholder — requires a `get-shopify-customer-orders` edge function to be built later, or uses existing Shopify integration data)

Fetch memory on ticket selection: `supabase.from("customer_memory").select("*").eq("store_id", ...).eq("customer_phone", ...).maybeSingle()`

## 4. Close/Reopen Ticket Buttons

Add to the ticket header bar:
- If `open`: "Fechar ticket" button with `CheckCircle` icon
- If `closed`: "Reabrir" button with `RefreshCw` icon
- Updates ticket status via `supabase.from("tickets").update({ status })` and refetches

## 5. Edge Function: `verify-zapi-connection`

Create `supabase/functions/verify-zapi-connection/index.ts`:
- Receives `{ instance_id, token, client_token }`
- Calls Z-API status endpoint: `GET https://api.z-api.io/instances/{id}/token/{token}/status`
- Returns `{ success: true/false, message }`
- Includes CORS headers

**Settings page**: Add "Verificar Conexão" button in the Z-API card that invokes this function and shows a toast with the result.

## 6. Webhook Setup Instructions

Add an instructional card below the webhook URL field in Settings:

```
Como configurar:
1. Acesse o painel da Z-API
2. Vá em sua instância > Webhooks
3. Em "Ao receber mensagem", cole a URL acima
4. Clique em Salvar
5. Volte aqui e clique em Verificar Conexão
```

Styled as a muted info card with an `Info` icon.

## 7. Typing Indicator in Scheduler

Update `whatsapp-reply-scheduler/index.ts` to add typing simulation before sending:
1. Call Z-API `send-chat-state` with `chatState: "composing"`
2. Wait `ai_response_delay` seconds
3. Send the AI message
4. Call `send-chat-state` with `chatState: "paused"`

---

## Files Modified/Created

| File | Action |
|------|--------|
| `supabase/migrations/...` | New migration: realtime + pg_cron/pg_net extensions |
| SQL insert (non-migration) | CRON job schedule |
| `src/pages/Tickets.tsx` | Customer sidebar enhancement + close/reopen buttons |
| `src/pages/Settings.tsx` | Verify connection button + webhook instructions card |
| `supabase/functions/verify-zapi-connection/index.ts` | New edge function |
| `supabase/functions/whatsapp-reply-scheduler/index.ts` | Add typing indicator logic |

