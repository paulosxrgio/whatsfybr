

# Integração Shopify no WhatsApp — Busca de Pedidos por Telefone + Verificação de Tokens

## Visão Geral

Criar uma Edge Function que busca pedidos do cliente na Shopify usando o telefone do ticket WhatsApp, exibir os pedidos na sidebar do chat, e adicionar verificação dos tokens Shopify na página de Configurações.

## Arquitetura

```text
Tickets.tsx (sidebar) → fetch-shopify-orders (Edge Function)
                              │
                              ├─ Busca settings (store_url, client_id, client_secret)
                              ├─ POST /admin/oauth/access_token → access_token
                              ├─ GraphQL: customers(query: "phone:+55...")
                              │     ├─ Tenta com código do país
                              │     └─ Fallback: tenta sem código do país
                              ├─ Se encontrou → legacyResourceId
                              ├─ GraphQL: orders(query: "customer_id:XXX", first: 5)
                              └─ Retorna pedidos formatados
```

## Detalhes Técnicos

### 1. Nova Edge Function: `fetch-shopify-orders`

Recebe `{ store_id, customer_phone }`. Fluxo:

1. Busca `shopify_store_url`, `shopify_client_id`, `shopify_client_secret` da tabela `settings`
2. Obtém `access_token` via OAuth (`/admin/oauth/access_token`)
3. Normaliza o telefone: remove não-dígitos, tenta variações com/sem código do país
4. GraphQL Admin API: `customers(first: 3, query: "phone:+5511999999999")`
   - Se não encontrar, tenta sem código do país: `phone:11999999999`
   - Se múltiplos resultados, usa o primeiro
5. Obtém `legacyResourceId` do customer
6. GraphQL: `orders(first: 5, sortKey: CREATED_AT, reverse: true, query: "customer_id:12345")`
7. Retorna array de pedidos com: `order_number`, `total_price`, `currency`, `financial_status`, `fulfillment_status`, `created_at`, `tracking_number`, `tracking_url`, `line_items[]`

**Nota sobre autenticação Shopify**: O fluxo `client_id` + `client_secret` via POST a `/admin/oauth/access_token` requer um `code` de autorização OAuth — não funciona só com ID+secret. Vou verificar se o `client_secret` é na verdade um Admin API access token (padrão `shpat_...`). Se for, usa direto como `X-Shopify-Access-Token`. Se não, implemento o fluxo correto com o access token.

### 2. Nova Edge Function: `verify-shopify-connection`

Testa os tokens Shopify fazendo uma chamada leve (ex: `shop.name` via GraphQL). Retorna sucesso ou erro detalhado (401 = token inválido, 403 = sem permissão, 404 = loja não encontrada).

### 3. Frontend — Sidebar de Pedidos (Tickets.tsx)

Na sidebar do ticket (painel direito, após "Memória do Cliente"), adicionar seção "Pedidos Shopify":
- Quando um ticket é selecionado, chama `fetch-shopify-orders` com `store_id` + `customer_phone`
- Exibe lista de pedidos com: número, valor, status, fulfillment, tracking
- Loading state enquanto busca
- Mensagem "Nenhum pedido encontrado" ou "Shopify não configurada" quando aplicável

### 4. Frontend — Verificação de Tokens Shopify (Settings.tsx)

Na seção Shopify das Configurações, adicionar botão "Verificar Conexão Shopify":
- Chama `verify-shopify-connection` com as credenciais da loja
- Mostra status: conexão válida, token inválido, loja não encontrada, sem permissão

### 5. Normalização de Telefone

Estratégia de busca múltipla na Shopify:
1. Telefone com `+` e código do país: `+5511999999999`
2. Sem `+`: `5511999999999`
3. Só DDD+número (sem código país): `11999999999`
4. Busca genérica: `phone:*999999999` (últimos 9 dígitos)

Se nenhuma variação encontrar, retorna array vazio.

## Arquivos

| Arquivo | Mudança |
|---------|---------|
| `supabase/functions/fetch-shopify-orders/index.ts` | Nova — busca pedidos por telefone |
| `supabase/functions/verify-shopify-connection/index.ts` | Nova — testa tokens Shopify |
| `src/pages/Tickets.tsx` | Adiciona seção de pedidos na sidebar |
| `src/pages/Settings.tsx` | Adiciona botão verificar conexão Shopify |

