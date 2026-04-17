

# Diagnóstico Completo — Suportfy

## 1. EDGE FUNCTIONS (9 ativas)

| Função | O que faz |
|---|---|
| `process-inbound-whatsapp` | Webhook que recebe mensagens da Z-API, cria/reaproveita ticket, salva mensagem, transcreve áudio (Whisper) e enfileira resposta com espera inteligente de 45s |
| `whatsapp-reply-scheduler` | **Cron a cada minuto.** Processa fila `auto_reply_queue`, detecta intenção, extrai fatos, busca pedidos Shopify, gera resposta via IA e envia pela Z-API |
| `send-whatsapp-reply` | Envia mensagem manual pela Z-API (usado pelo painel de tickets) |
| `process-shopify-webhook` | Recebe webhook `orders/fulfilled` da Shopify, valida HMAC e dispara WhatsApp de "pedido enviado" |
| `fetch-shopify-orders` | Busca pedidos do cliente no Shopify via GraphQL pelo telefone (usado pela IA como contexto) |
| `transcribe-audio` | Transcreve áudio do WhatsApp via OpenAI Whisper |
| `verify-zapi-connection` | Testa credenciais Z-API |
| `verify-shopify-connection` | Testa credenciais Shopify |
| `verify-ai-connection` | Testa chave OpenAI/Anthropic |

## 2. TABELAS DO BANCO (10)

| Tabela | Conteúdo |
|---|---|
| `stores` | Lojas do usuário (multi-loja por user_id) |
| `account_settings` | Chave OpenAI/Anthropic, modelo IA (nível conta) |
| `settings` | Config por loja: Z-API, Shopify, prompt, delay, ai_is_active |
| `tickets` | Conversas abertas/fechadas com cliente, sentiment, intent |
| `messages` | Histórico de mensagens inbound/outbound, com zapi_message_id (idempotência) |
| `customer_memory` | Memória persistente do cliente (nome, sentimento, total_interações) |
| `auto_reply_queue` | Fila de respostas pendentes com espera inteligente |
| `requests` | Pedidos especiais detectados (reembolso, troca) |
| `whatsapp_notifications` | Log de notificações automáticas (pedido enviado) |
| `user_roles` | Roles via enum `app_role` (admin) |

## 3. FLUXO PRINCIPAL

```text
1. Cliente manda mensagem no WhatsApp
2. Z-API → POST process-inbound-whatsapp
3. Filtros: ignora fromMe, grupo, LID, duplicata (zapi_message_id)
4. Busca/cria ticket (1 ticket aberto por phone+store)
5. Se áudio → transcribe-audio (Whisper)
6. Salva mensagem inbound + atualiza customer_memory
7. Se ai_is_active: insere/reseta auto_reply_queue (scheduled_for = +45s)
                    Se já havia item pending → reseta timer e ++message_count
8. Cron pg_cron a cada 1min → whatsapp-reply-scheduler
9. Pega itens vencidos (scheduled_for <= now), por loja:
   a. Detecta intenção (sales/support/unclear) - IA call #1
   b. Extrai fatos do histórico (produto/cor/tamanho/cep/pedido) - IA call #2
   c. Busca pedidos Shopify do cliente
   d. Monta prompt: base + modo + fatos + histórico + pedidos + alerta loja errada
   e. Gera resposta - IA call #3 (max_output_tokens: 400)
   f. Envia "composing" → espera delay → send-text → "paused"
   g. Salva mensagem outbound + atualiza ticket
```

## 4. SISTEMA DE IA

- **Modelo atual:** `gpt-4o-mini` (confirmado no banco para o único usuário)
- **Provider:** `openai` via Responses API (`/v1/responses`)
- **Chamadas POR MENSAGEM RECEBIDA: 3**
  1. Detecção de intenção — `max_output_tokens: 16`
  2. Extração de fatos — `max_output_tokens: 100`
  3. Geração da resposta — `max_output_tokens: 400`
- **Score/análise de qualidade:** ❌ NÃO IMPLEMENTADO (não existe `analyze-whatsapp-response`)
- **Auto-melhoria de prompt:** ❌ NÃO IMPLEMENTADO (não existe `optimize-whatsapp-prompt` nem cron semanal)

## 5. INTEGRAÇÕES ATIVAS

| Integração | Status |
|---|---|
| Z-API | ✅ Configurada (instance_id, token, client_token salvos) |
| Shopify | ✅ Integrada (URL e secret salvos), GraphQL Admin API 2024-01 |
| OpenAI | ✅ Configurada (key em account_settings, modelo gpt-4o-mini) |
| Resend | ❌ NÃO configurada (nem secret, nem connector, nem código) |
| Zedy | ❌ NÃO existe no projeto (você quis dizer Z-API? Essa está ativa) |
| `notify_order_fulfilled` | ⚠️ Está **false** — webhook Shopify recebe mas não dispara |

## 6. PROBLEMAS CONHECIDOS

1. **`fetch-shopify-orders` retorna campos no formato GraphQL, mas o scheduler lê formato REST.** O scheduler usa `o.financial_status`, `o.fulfillment_status`, `o.line_items`, mas a função retorna `status`, `financial_status`, `items` — campo `fulfillment_status` **não existe no retorno** → IA sempre vê "Aguardando envio" mesmo para pedidos enviados, e itens também não são exibidos corretamente.
2. **Notificação de envio desativada** (`notify_order_fulfilled = false`) — cliente não recebe aviso quando pedido sai.
3. **3 chamadas IA por mensagem** — extração de fatos roda mesmo em conversas curtas. Custo poderia cair ~33% pulando fatos quando histórico < 2 mensagens.
4. **Sem proteção contra loop de erro** — se geração falhar, item vira `failed` mas não tenta novamente nem notifica.
5. **`AbortError` em `e.name`** sem tipagem — TypeScript pode reclamar (`e` é `unknown` em try/catch).
6. **Sentiment detection é regex hardcoded** em PT-BR no scheduler (linhas 716-720), não usa IA.
7. **RLS warning potencial:** `cron.job` existe e roda com anon key embutida — funcional, mas exposta no banco.
8. **`Resend` mencionado mas inexistente** — qualquer fluxo de email não funciona.

## 7. O QUE FOI PLANEJADO MAS NÃO IMPLEMENTADO

Baseado em conversas anteriores e código existente:

- **`analyze-whatsapp-response`** — score de qualidade da resposta (era para rodar assíncrono se ticket > 3 msgs)
- **`optimize-whatsapp-prompt`** — auto-melhoria semanal do prompt (cron `0 9 * * 1`)
- **Logs de tokens** (prompt_tokens/completion_tokens) para monitorar custo por mensagem
- **Dashboard de custos de IA** na página Analytics
- **Migration para mudar DEFAULT** de `ai_model` em `account_settings`/`settings` de `'gpt-4o'` para `'gpt-4o-mini'` (atualmente os defaults da coluna ainda são `gpt-4o`)
- **UPDATE da tabela `settings`** (loja) com gpt-4o-mini — só `account_settings` foi atualizada
- **Notificação de pedido enviado** está codada mas **desligada** por config
- **Resend / sistema de email** — citado, mas não existe
- **Score automático condicional** (rodar só se ticket > 3 msgs) — discutido mas não implementado

