

# Diagnóstico Completo: Mensagens Sem Resposta + Contatos Duplicados

## Problema 1: IA Não Responde (73 mensagens com status "failed")

### Evidências Coletadas

| Dado | Valor |
|------|-------|
| Itens `failed` na fila | 73 |
| Itens `done` | 13 (últimos em 09/abr) |
| Chave OpenAI | Existe (164 chars, prefixo `sk-proj`) |
| Provider | `openai` / modelo `gpt-4o` |
| Logs de erro | Nenhum visível |

### Causa Raiz Identificada

A chave OpenAI **parou de funcionar** por volta de 9 de abril. Desde então, 100% dos itens falham. O código faz duas chamadas à API OpenAI por ticket (detecção de intenção + geração de resposta). Quando a chamada retorna erro (quota excedida, chave revogada, créditos esgotados), o `catch` no bloco interno (linha 511) captura o erro e marca como `failed`, mas **o log `console.error("Queue item error:", e)` não está aparecendo nos logs** — possivelmente porque o erro ocorre dentro do `fetch` sem throw (a API retorna 401/429 com JSON, não lança exceção).

O fluxo real é:
1. `fetch` para OpenAI retorna HTTP 401 ou 429 com corpo de erro JSON
2. `data.choices?.[0]?.message?.content` resulta em `""` (undefined)
3. Para detecção de intenção: `intentRaw = ""` → `intent = "unclear"` (silencioso)
4. Para geração de resposta: `responseText = ""` → entra no `if (!responseText)` na linha 438 → marca como `failed`
5. Nenhum log de erro é gerado

### O que Falta no Código

O scheduler **não verifica o HTTP status** da resposta da OpenAI. Não loga o erro retornado pela API. A falha é completamente silenciosa.

### Correção Necessária

1. **Verificar e logar a resposta da OpenAI** — após o `fetch`, checar `res.ok` e logar `data.error` se existir
2. **Validar a chave antes de processar** — ou pelo menos logar claramente quando a API retorna erro
3. **O usuário deve verificar se a chave OpenAI ainda é válida** — gerar uma nova se necessário nas configurações da conta

---

## Problema 2: Tickets Duplicados

### Evidências Coletadas

| Telefone | Tickets abertos | Intervalo de criação |
|----------|----------------|---------------------|
| `194103010681057` | 2 | 78ms |
| `557599894169` | 2 | (verificar) |

### Causa Raiz: Race Condition

Quando a Z-API envia dois webhooks simultâneos (ex: `PresenceChatCallback` + `ReceivedCallback` chegando juntos, ou duas mensagens rápidas), duas instâncias do Edge Function executam em paralelo:

```text
Instância A: SELECT ticket WHERE phone=X → não encontrou → INSERT ticket
Instância B: SELECT ticket WHERE phone=X → não encontrou → INSERT ticket (78ms depois)
```

Ambas fazem o SELECT antes que a outra faça o INSERT. Resultado: dois tickets.

### Por que o Fix Anterior Não Resolveu

O código atual (linhas 91-99) faz `SELECT ... .eq("status", "open")` seguido de `INSERT`. Isso é uma operação **não-atômica** — não há lock, não há constraint única no banco. O fix anterior corrigiu a lógica sequencial mas **não protege contra concorrência**.

### Telefone Suspeito

`194103010681057` tem 15 dígitos — números brasileiros têm 12-13. Pode ser um LID (Linked ID) da Z-API sendo salvo como telefone, criando tickets fantasma.

---

## Plano de Correção

### 1. Corrigir a Falha Silenciosa da IA (Prioridade Crítica)

No `whatsapp-reply-scheduler/index.ts`, após cada `fetch` à OpenAI/Anthropic:
- Verificar `res.status` e logar o erro completo quando != 200
- Logar `data.error` explicitamente antes de marcar como failed
- Isso permitirá ver **exatamente** por que está falhando (quota, chave inválida, etc.)

### 2. Adicionar Índice Único Parcial para Tickets (Prioridade Alta)

```sql
CREATE UNIQUE INDEX idx_one_open_ticket_per_phone_store 
ON tickets (store_id, customer_phone) 
WHERE status = 'open';
```

Isso resolve a race condition no nível do banco — a segunda inserção simplesmente falha com conflito. O código deve tratar esse erro fazendo um novo SELECT.

### 3. Filtrar LIDs no `process-inbound-whatsapp` (Prioridade Média)

Números com mais de 13 dígitos (como `194103010681057`) são LIDs da Z-API, não telefones reais. Devem ser ignorados ou tratados separadamente.

### 4. Limpar Dados Existentes

- Fechar tickets duplicados (manter o mais recente)
- Limpar entradas `failed` antigas da `auto_reply_queue`

### 5. Melhorar Logging no Scheduler

Adicionar logs em pontos críticos:
- Resultado HTTP da chamada OpenAI
- Corpo do erro quando a API falha
- Tempo de execução de cada etapa

## Arquivos a Modificar

| Arquivo | Mudança |
|---------|---------|
| `supabase/functions/whatsapp-reply-scheduler/index.ts` | Adicionar verificação de `res.status` e logging de erros da API |
| `supabase/functions/process-inbound-whatsapp/index.ts` | Filtrar telefones com >13 dígitos (LIDs) |
| Nova migration | Criar índice único parcial + limpar duplicados + limpar fila failed |

