---
name: Treinamento por Operador
description: Tabela training_examples alimenta o prompt da Sophia com respostas humanas ideais
type: feature
---

Quando o operador pausa a IA num ticket (tickets.ai_paused = true) e responde manualmente via UI, o `send-whatsapp-reply` salva a mensagem com `source='manual'` e cria automaticamente um registro em `training_examples` com:
- customer_input: concatenação das últimas até 4 mensagens inbound do ticket
- ideal_response: a mensagem enviada pelo operador
- source: 'human_operator'

O `whatsapp-reply-scheduler` busca os 10 exemplos mais recentes da loja e injeta no `baseSystemPrompt` num bloco "EXEMPLOS DE RESPOSTAS IDEAIS" (truncado a 2000 chars), instruindo a Sophia a imitar tom/estrutura/estilo.

Aba "Treinamento" em /ai-agent permite visualizar e excluir exemplos ruins. Não há aprovação manual — todos exemplos entram automaticamente. Operador deve podar deletando.

Mensagens enviadas pelo botão "Bot" (Gerar resposta com IA) NÃO criam exemplos — apenas envios manuais (source=manual) geram training_examples.
