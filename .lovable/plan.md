

# Correções do Sistema — Limpeza de Loja + IA Funcional

## 1. Auto-deletar "Minha Loja Teste"

**Arquivo:** `src/contexts/StoreContext.tsx`

Na função `fetchStores`, após carregar as lojas, verificar se existe uma loja chamada "Minha Loja Teste" E pelo menos uma outra loja. Se sim, deletar silenciosamente a "Minha Loja Teste" e re-fetch.

## 2. Página Agente IA — Campos editáveis completos

**Arquivo:** `src/pages/AIAgent.tsx`

Reescrever a página para incluir:
- Toggle "Ativar respostas automáticas" (salva `ai_is_active`)
- Dropdown Provedor: OpenAI / Anthropic (salva `ai_provider`)
- Dropdown Modelo (dinâmico conforme provedor — OpenAI: gpt-4o, gpt-4o-mini, gpt-3.5-turbo; Anthropic: claude-sonnet-4-20250514, claude-3-haiku)
- Campo numérico Delay em segundos (salva `ai_response_delay`)
- Textarea editável do System Prompt (salva `ai_system_prompt`)
- Default prompt preenchido automaticamente se vazio, usando `currentStore.name`
- Botão "Salvar configurações" que faz upsert na tabela `settings`

O default prompt será:
```
Você é Sophia, atendente de suporte da loja ${storeName} via WhatsApp.
IDIOMA: Sempre responda em português brasileiro.
TOM: Simpático, humano, caloroso e direto...
[prompt completo conforme especificado pelo usuário]
```

## 3. Scheduler — Verificar ai_is_active antes de processar

**Arquivo:** `supabase/functions/whatsapp-reply-scheduler/index.ts`

Já busca `settings` por item da fila. Adicionar check: se `settings.ai_is_active === false`, marcar como "skipped" e pular. Garantir que o `ai_system_prompt` usa fallback para o prompt padrão.

## 4. process-inbound-whatsapp — Já usa store_id via query param

**Arquivo:** `supabase/functions/process-inbound-whatsapp/index.ts`

O código atual já pega `store_id` do query param (`url.searchParams.get("store_id")`), então essa parte já está implementada corretamente. Nenhuma mudança necessária.

## 5. Webhook URL nas Configurações — Já implementado

**Arquivo:** `src/pages/Settings.tsx`

A URL do webhook já inclui `store_id=${currentStore.id}` (linha 141). Nenhuma mudança necessária.

---

## Resumo de Arquivos

| Arquivo | Mudança |
|---------|---------|
| `src/contexts/StoreContext.tsx` | Auto-delete "Minha Loja Teste" |
| `src/pages/AIAgent.tsx` | Reescrever com campos editáveis completos + botão salvar |
| `supabase/functions/whatsapp-reply-scheduler/index.ts` | Check `ai_is_active`, fallback prompt |

