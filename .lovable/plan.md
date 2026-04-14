

# Automação de Mensagem WhatsApp para Pedido Enviado (Shopify)

## Visão Geral

Criar um pipeline completo: Shopify envia webhook de fulfillment → Edge Function processa → monta mensagem → envia via Z-API → salva log. Sem alterar nenhuma funcionalidade existente.

## Arquitetura

```text
Shopify (orders/fulfilled webhook)
        │
        ▼
Edge Function: process-shopify-webhook
        │
        ├─ Valida payload + extrai dados
        ├─ Verifica duplicata (idempotência por shopify_order_id + event_type)
        ├─ Insere na tabela whatsapp_notifications (status: pending)
        └─ Chama envio Z-API direto (sem fila assíncrona — é evento pontual)
              │
              ├─ Sucesso → status: sent
              └─ Falha → status: failed + error_message
```

## Detalhes Técnicos

### 1. Nova tabela: `whatsapp_notifications`

```sql
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
```

A constraint `UNIQUE(store_id, shopify_order_id, event_type)` garante **idempotência** — se a Shopify reenviar o mesmo webhook, o INSERT falha e não envia duplicado.

### 2. Nova Edge Function: `process-shopify-webhook`

Recebe o webhook `orders/fulfilled` da Shopify. O `store_id` vem via query param (igual ao webhook da Z-API).

Fluxo:
1. Valida HMAC da Shopify (usando `shopify_client_secret` da tabela `settings`) para autenticidade
2. Extrai: `order.name`, `order.customer.first_name`, `order.customer.phone` (ou `order.shipping_address.phone`), `fulfillment.tracking_number`, `fulfillment.tracking_url`, `fulfillment.tracking_company`
3. Normaliza telefone (remove não-dígitos)
4. Tenta INSERT na `whatsapp_notifications` — se conflito (duplicata), retorna 200 sem enviar
5. Monta mensagem com template
6. Busca credenciais Z-API da tabela `settings`
7. Envia via Z-API (`send-text`)
8. Atualiza status para `sent` ou `failed`

### 3. Webhook Shopify a configurar

- **Tópico**: `orders/fulfilled`
- **URL**: `https://tkfacslgbllqzjeotzrd.supabase.co/functions/v1/process-shopify-webhook?store_id=<STORE_ID>`
- **Formato**: JSON

O `shopify_client_secret` já existe na tabela `settings` e será usado para verificar a assinatura HMAC do webhook.

### 4. Template de mensagem

```
Olá, {{nome}}! 😊 Seu pedido {{numero_pedido}} foi enviado com sucesso!

Código de rastreio: {{codigo}}
Acompanhe aqui: {{link}}

Abraços, Sophia
```

Se não houver código de rastreio, a mensagem omite essas linhas.

### 5. Integração com Z-API

Reutiliza exatamente o mesmo padrão do `send-whatsapp-reply`:
- Busca `zapi_instance_id`, `zapi_token`, `zapi_client_token` da tabela `settings`
- POST para `https://api.z-api.io/instances/{id}/token/{token}/send-text`
- Header `Client-Token`

### 6. Prevenção de duplicatas

Duas camadas:
1. **Banco**: constraint UNIQUE em `(store_id, shopify_order_id, event_type)`
2. **Código**: INSERT com tratamento de erro de conflito — retorna 200 sem reenviar

### 7. UI — Seção na página de Settings

Adicionar na página de Configurações uma seção "Automações" mostrando:
- URL do webhook Shopify para copiar (igual ao padrão da Z-API)
- Switch para ativar/desativar notificação de pedido enviado (campo na tabela `settings`)
- Instrução de como configurar na Shopify

## Arquivos

| Arquivo | Mudança |
|---------|---------|
| Nova migration | Cria tabela `whatsapp_notifications` |
| `supabase/functions/process-shopify-webhook/index.ts` | Nova Edge Function |
| `src/pages/Settings.tsx` | Seção "Automações" com URL do webhook |
| `src/integrations/supabase/types.ts` | Auto-atualizado |

## Fora de Escopo
- Outras automações (pedido criado, entregue, etc.)
- Dashboard/página de visualização das notificações (pode ser próximo passo)

