
# Suportfy WhatsApp — Sistema de Atendimento via WhatsApp

## Visão Geral
Sistema completo de atendimento ao cliente via WhatsApp, com IA (Sophia), integração Z-API, Shopify e interface estilo chat WhatsApp.

---

## Fase 1: Banco de Dados e Autenticação

- Habilitar Lovable Cloud (auth + banco)
- Criar todas as tabelas: `stores`, `settings`, `tickets`, `messages`, `auto_reply_queue`, `customer_memory`, `requests`
- Criar tabela `user_roles` para controle de acesso
- Ativar RLS em todas as tabelas com políticas baseadas em `store_id` + `user_id`
- Criar view segura para `settings` (ocultar API keys sensíveis em SELECT direto)

## Fase 2: Edge Functions

### `process-inbound-whatsapp`
- Webhook público que recebe mensagens da Z-API
- Filtra `fromMe: true` e mensagens de grupo
- Busca/cria ticket pelo phone + store
- Salva mensagem inbound
- Enfileira resposta automática se IA ativa

### `whatsapp-reply-scheduler`
- Processa fila `auto_reply_queue`
- Busca histórico (últimas 10 msgs), memória do cliente, pedidos Shopify
- Gera resposta via OpenAI ou Anthropic (configurável por loja)
- Envia via Z-API (`send-text`)
- Salva mensagem outbound + atualiza memória

### `send-whatsapp-reply`
- Envio manual pelo atendente humano
- Recebe `ticket_id`, `message`, `store_id`
- Envia via Z-API e salva como outbound

### `transcribe-audio`
- Baixa áudio da URL Z-API
- Transcreve via OpenAI Whisper
- Salva transcrição como conteúdo da mensagem

## Fase 3: Interface — Layout e Navegação

- Layout com sidebar fixa: Tickets, Agente IA, Solicitações, Analytics, Configurações
- `StoreSwitcher` no topo para alternar entre lojas
- Autenticação com login/signup

## Fase 4: Página de Tickets (principal)

- **Painel esquerdo**: lista de tickets com avatar (inicial do nome), phone, última mensagem, horário, badge de sentimento (😊😐😤😡), filtros (Todos/Abertos/Fechados)
- **Painel central**: área de conversa estilo WhatsApp — bolhas cinza (inbound) e verdes (outbound), suporte a imagens, áudio (player), documentos. Campo de resposta manual + botão "Gerar Resposta IA"
- **Painel direito**: info do cliente (nome, phone, sentimento, histórico) + pedidos Shopify vinculados

## Fase 5: Página de Configurações

- **Z-API**: campos Instance ID, Token, Client Token + botão "Verificar Conexão" + exibição da URL do webhook para copiar
- **Provedor IA**: dropdown OpenAI/Anthropic + API key + modelo + verificar
- **Agente IA**: toggle ativar/desativar + delay (segundos) + system prompt editável
- **Shopify**: URL da loja + Client ID + Client Secret

## Fase 6: Página Agente IA

- Score médio de qualidade das respostas
- Toggle ativo/inativo
- System prompt atual com controle de versão
- Sugestões de melhoria pendentes

## Fase 7: Páginas Complementares

- **Solicitações**: lista de requests (reembolsos, trocas, etc.) extraídos das conversas
- **Analytics**: métricas básicas — tickets abertos/fechados, tempo médio de resposta, sentimento geral

## Detalhes Técnicos

- System prompt padrão da Sophia (versão WhatsApp BR) embutido como default
- API keys da Z-API, OpenAI e Anthropic armazenadas por loja na tabela `settings`
- Realtime do Supabase para atualizar tickets e mensagens em tempo real na interface
