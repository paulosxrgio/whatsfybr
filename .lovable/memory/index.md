# Project Memory

## Core
Suportfy WhatsApp: Atendimento via Z-API + Shopify.
Stack: React, Tailwind, Shadcn, Supabase (Edge Functions), OpenAI/Anthropic.
Segurança: RLS rigoroso em todas as tabelas por user_id e store_id.
Realtime: Sincronização em tempo real nas tabelas tickets e messages via Supabase.
Pause IA por ticket: tickets.ai_paused desabilita scheduler; resposta manual vira exemplo de treinamento.

## Memories
- [Persona Sophia](mem://ia/persona-sophia) — Regras de atendimento, tom de voz (Apple/Spotify) e diretrizes específicas
- [Interface do Chat](mem://estilo/interface-chat) — UI inspirada no WhatsApp, badges de sentimento e painel lateral
- [Automação e IA](mem://funcionalidades/automacao-e-ia) — Fila pg_cron, transcrição Whisper e espera inteligente de 45s
- [Multi-loja e RLS](mem://arquitetura/seguranca-e-dados) — Separação de config conta/loja e aplicação estrita de RLS
- [Integração Z-API](mem://integracao/whatsapp-zapi) — Idempotência, filtragem de webhooks e normalização de telefones
- [Ferramentas de Diagnóstico](mem://desenvolvimento/ferramentas-diagnostico) — UI para diagnóstico de webhook Z-API e simulação de mensagens
- [Gestão de Tickets](mem://funcionalidades/gestao-de-tickets) — Apenas um ticket aberto por número de telefone por loja, toggle ai_paused individual
- [Modos de Intenção da IA](mem://ia/modos-e-intencao) — Detecção automática de vendas/suporte e adaptação do comportamento
- [Treinamento por Operador](mem://ia/treinamento-operador) — Tabela training_examples alimenta o prompt da Sophia com respostas humanas ideais
