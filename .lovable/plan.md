

## Pause IA + Aprendizado por Operador

3 funcionalidades integradas no fluxo de tickets.

### 1. Migração de banco

```sql
ALTER TABLE tickets ADD COLUMN IF NOT EXISTS ai_paused boolean DEFAULT false;
ALTER TABLE tickets ADD COLUMN IF NOT EXISTS ai_paused_at timestamptz;
ALTER TABLE messages ADD COLUMN IF NOT EXISTS source text DEFAULT 'ai';

CREATE TABLE IF NOT EXISTS training_examples (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  store_id uuid NOT NULL,
  ticket_id uuid,
  customer_input text,
  ideal_response text NOT NULL,
  source text DEFAULT 'human_operator',
  applied boolean DEFAULT false,
  created_at timestamptz DEFAULT now()
);

ALTER TABLE training_examples ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users manage own store training" ON training_examples
  FOR ALL USING (store_id IN (SELECT user_store_ids()))
  WITH CHECK (store_id IN (SELECT user_store_ids()));

CREATE INDEX idx_training_store_created ON training_examples(store_id, created_at DESC);
```

### 2. Toggle "IA ativa/pausada" no header — `src/pages/Tickets.tsx`

- Adicionar `ai_paused` ao tipo `Ticket`.
- No header (linhas 660-684), adicionar botão verde/vermelho que faz update em `tickets.ai_paused` e `ai_paused_at`.
- Substituir o badge fixo "IA ativa" por esse toggle.
- O realtime já existente em `tickets-realtime` atualiza o estado.
- Quando `ai_paused`, mostrar banner âmbar acima do input: "⏸ IA pausada — você está respondendo manualmente".

### 3. Scheduler ignora tickets pausados — `whatsapp-reply-scheduler/index.ts`

No loop por item da fila (linha 36+), logo após buscar `ticket` (linha 86), adicionar:

```ts
if (ticket.ai_paused) {
  await supabase.from("auto_reply_queue").update({ status: "skipped" }).eq("id", item.id);
  console.log(`[SKIP] ticket ${item.ticket_id} com IA pausada`);
  continue;
}
```

### 4. Mensagens manuais salvam exemplo de treinamento

Duas opções de onde fazer isso:
- **`send-whatsapp-reply` edge function** — quando chamada pela UI manual, salvar `source='manual'` na inserção da mensagem e criar `training_example`. Esta é a opção que vou usar porque centraliza no servidor (mais robusto e evita inserções diretas do client passarem batido).

No `send-whatsapp-reply/index.ts`:
- Adicionar `source: 'manual'` no insert da mensagem outbound.
- Após enviar, buscar últimas 6 mensagens do ticket, montar `customer_input` (concat de últimas inbound), e inserir em `training_examples`.

### 5. Scheduler usa exemplos no prompt — `whatsapp-reply-scheduler/index.ts`

Antes de montar o prompt final (perto da linha 306), buscar últimos 10 exemplos do `store_id` e injetar como bloco `EXEMPLOS DE RESPOSTAS IDEAIS` no `baseSystemPrompt`. Truncar para evitar prompts gigantes (limite ~2000 chars no bloco).

### 6. Aba "Treinamento" em `src/pages/AIAgent.tsx`

- Envolver o conteúdo atual em `<Tabs>` com 2 abas: "Configuração" (atual) e "Treinamento".
- Aba Treinamento: lista os exemplos de `training_examples` da loja com:
  - data, customer_input (preview), ideal_response (preview)
  - botão "Excluir" (delete from training_examples)
- Sem edição inline — só visualizar e deletar os ruins.

### Arquivos editados
- Migração nova
- `src/pages/Tickets.tsx` (toggle, banner, tipo Ticket)
- `src/pages/AIAgent.tsx` (Tabs + aba Treinamento)
- `supabase/functions/whatsapp-reply-scheduler/index.ts` (skip pausados + injeção de exemplos)
- `supabase/functions/send-whatsapp-reply/index.ts` (source=manual + insert training_example)

### Observações
- Mensagens enviadas via "Gerar resposta com IA" (botão azul) devem manter `source='ai'` — vou diferenciar pelo parâmetro passado do client (`source: 'manual' | 'ai_generated'`).
- Não vou criar UI de "approved/applied" — todos os exemplos entram automaticamente no prompt (limite 10 mais recentes). Operador pode podar deletando.

