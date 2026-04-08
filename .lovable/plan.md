

# Correção da Integração Z-API — 5 Pontos Críticos

## Overview
Corrigir extração de payload, endpoints, headers, typing indicator e idempotência em 4 edge functions.

---

## 1. `process-inbound-whatsapp/index.ts` — Payload + Idempotência

- Adicionar filtro `body.type !== 'ReceivedCallback'` → skip
- Separar checks de `fromMe` e `isGroup` em returns individuais
- Corrigir `senderName` para fallback em `body.chatName`
- Corrigir `messageType`: não usar `body.type === "ReceivedCallback"` para determinar tipo — usar detecção por presença de `body.image`, `body.audio`, `body.video`, `body.document`
- Adicionar suporte a `body.video` (videoUrl)
- Adicionar check de idempotência por `zapi_message_id` antes de inserir mensagem
- Limpar phone com `.replace(/\D/g, '')`

## 2. `send-whatsapp-reply/index.ts` — Limpar phone

- Adicionar `cleanPhone = ticket.customer_phone.replace(/\D/g, '')` antes de enviar
- Usar `cleanPhone` no body do Z-API

## 3. `verify-zapi-connection/index.ts` — Já está correto

O código atual já usa `GET .../status` com `Client-Token` header e verifica `data.connected`. Adicionar `method: 'GET'` explícito para clareza, mas funcionalidade já está ok.

## 4. `whatsapp-reply-scheduler/index.ts` — Limpar phone + typing flow

- Adicionar `cleanPhone = ticket.customer_phone.replace(/\D/g, '')` 
- Usar `cleanPhone` em todos os calls Z-API (send-chat-state e send-text)
- O fluxo composing → delay → send → paused já está implementado corretamente

---

## Files

| File | Change |
|------|--------|
| `supabase/functions/process-inbound-whatsapp/index.ts` | Type filter, media detection, idempotência, phone cleanup |
| `supabase/functions/send-whatsapp-reply/index.ts` | Phone cleanup |
| `supabase/functions/verify-zapi-connection/index.ts` | Add explicit GET method |
| `supabase/functions/whatsapp-reply-scheduler/index.ts` | Phone cleanup |

