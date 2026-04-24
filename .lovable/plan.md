
# Plano: Análise de Corpus pelo Cérebro

Construir uma funcionalidade onde o Cérebro digere um dataset grande (3.702 pares de conversa) **uma única vez**, extrai conhecimento estratégico consolidado e passa a usá-lo como contexto permanente em toda análise diária da Sophia.

---

## 1. Migration SQL (schema)

Adicionar 3 colunas em `settings`:

```sql
ALTER TABLE public.settings
  ADD COLUMN IF NOT EXISTS cerebro_corpus_knowledge text,
  ADD COLUMN IF NOT EXISTS corpus_analyzed_at timestamptz,
  ADD COLUMN IF NOT EXISTS corpus_pairs_analyzed integer DEFAULT 0;
```

RLS já existente em `settings` cobre essas colunas (policy "Users manage own store settings").

---

## 2. Nova Edge Function: `supabase/functions/analyze-corpus/index.ts`

**Endpoint:** POST `/analyze-corpus`
**Body:** `{ store_id: string, corpus_text: string }`

**Fluxo:**
1. Validar input (store_id UUID válido, corpus_text não vazio).
2. Buscar `account_settings.anthropic_api_key` do dono da loja (via `stores.user_id`). Fallback para `LOVABLE_API_KEY` no Lovable AI Gateway se não houver chave Anthropic — mais robusto e alinhado com o padrão do projeto.
3. **Parsear o corpus**: dividir por blocos `[N] intent=... | sentiment=... | sector=...` seguidos de `CLIENTE:` e `AGENTE:`. Resultado: array de pares `{ intent, sentiment, cliente, agente }`.
4. **Lotes de 50 pares** → ~74 lotes. Para cada lote:
   - Montar prompt de análise (texto que o usuário forneceu).
   - Chamar IA com `response_format: { type: "json_object" }`, `max_tokens: 2000`.
   - Coletar JSON parcial: `{ padroes_clientes, tecnicas_eficazes, erros_evitar, vocabulario_ideal, por_intent }`.
   - Pequeno `await sleep(300ms)` entre lotes para não estourar rate limit.
5. **Consolidação final**: chamada única adicional enviando os 74 JSONs parciais para a IA gerar um documento markdown unificado, deduplicado e cirúrgico, com seções:
   - Padrões de clientes (top 15)
   - Técnicas eficazes (top 15)
   - Erros a evitar (top 15)
   - Vocabulário ideal (lista)
   - Estruturas por intent (saudacao, reclamacao, prazo_entrega, troca_devolucao, duvida_produto, etc.)
6. Salvar em `settings`:
   ```ts
   await supabase.from('settings').update({
     cerebro_corpus_knowledge: finalMarkdown,
     corpus_analyzed_at: new Date().toISOString(),
     corpus_pairs_analyzed: totalPairs,
   }).eq('store_id', storeId);
   ```
7. Retornar `{ pairs_analyzed, batches_processed, knowledge_preview, knowledge_length }`.

**Streaming de progresso (importante por causa de timeout):**
- Edge Functions têm timeout. Com ~74 lotes + 1 consolidação, pode passar de 60s.
- Solução: retornar uma resposta **SSE (Server-Sent Events)** que emite eventos `{ type: "progress", current, total, message }` durante o processamento, e ao final `{ type: "done", ... }`. O frontend lê o stream e atualiza a progress bar.
- Isso também resolve UX (mostrar lote atual em tempo real).

**CORS:** headers padrão do projeto (já usados nas outras functions).

**Config:** não precisa de bloco em `supabase/config.toml` — `verify_jwt = false` é o default e a function chama o banco com SERVICE_ROLE.

---

## 3. Modificar `supabase/functions/supervisor-agent/index.ts`

Logo após buscar `settings` (já existe), incluir `cerebro_corpus_knowledge` no select e injetar no system prompt:

```ts
const { data: settings } = await supabase
  .from("settings")
  .select("ai_provider, ai_model, openai_api_key, anthropic_api_key, ai_system_prompt, zapi_instance_id, zapi_token, zapi_client_token, cerebro_memory, cerebro_corpus_knowledge")
  .eq("store_id", storeId)
  .maybeSingle();

const corpusContext = settings?.cerebro_corpus_knowledge
  ? `\n\n━━━━ CONHECIMENTO EXTRAÍDO DE ${settings as any).corpus_pairs_analyzed || 'milhares de'} CONVERSAS REAIS ━━━━\n${settings.cerebro_corpus_knowledge}\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n\n`
  : "";

const SUPERVISOR_SYSTEM_PROMPT = corpusContext + buildSupervisorPrompt(activeMemory);
```

Esse contexto agora informa **toda análise diária** do Cérebro, fazendo as 3 regras/dia serem mais bem fundamentadas.

---

## 4. UI: nova aba "Corpus" em `src/pages/AIAgent.tsx`

Adicionar `<TabsTrigger value="corpus">Corpus</TabsTrigger>` ao lado das abas existentes, com `<TabsContent value="corpus">` contendo dois cards:

**Card A — Carregar e Analisar:**
- Ícone `BookOpen` / `Database` + título "Análise de Corpus"
- Descrição: "Alimente o Cérebro com um grande dataset de conversas reais. Ele extrai padrões, técnicas e vocabulário ideal — esse conhecimento fica gravado permanentemente na memória dele."
- `<Input type="file" accept=".txt">` que ao mudar lê o arquivo via `FileReader`.
- Mostrar: "✓ X.XXX pares detectados" (contagem de blocos `[N]`).
- Botão `<Button>` "Analisar com o Cérebro" (disabled enquanto não há arquivo, ou enquanto está analisando).
- Quando analisando: `<Progress value={current/total*100} />` + texto "Processando lote X/74..." (vindo do SSE).
- Toasts em cada etapa importante; badge verde "Análise concluída" ao fim.

**Card B — Conhecimento Salvo:**
- Carregado via `useEffect` que faz `select cerebro_corpus_knowledge, corpus_analyzed_at, corpus_pairs_analyzed`.
- Se vazio: empty state "Nenhuma análise de corpus realizada ainda."
- Se preenchido:
  - Header com `corpus_pairs_analyzed` pares + data formatada (`format(date, 'PPpp')`).
  - `<ScrollArea className="h-96">` com o markdown renderizado em `<pre>` (ou um renderer simples — react-markdown não está instalado e não vou adicionar; `whitespace-pre-wrap` resolve).
  - Botão "Re-analisar" (sobrescreve — abre o card A) e botão destrutivo "Limpar conhecimento" com `AlertDialog` de confirmação.

**Visual:** segue paleta do projeto (já configurada em `index.css` / `tailwind.config.ts`) — usa tokens `bg-card`, `text-foreground`, `bg-primary` etc. **Não vou hardcodar `#080F1E` ou `#8B5CF6`** — uso os tokens semânticos do design system para manter consistência (preferência registrada).

**Chamada do frontend (streaming):**
```ts
const url = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/analyze-corpus`;
const resp = await fetch(url, {
  method: "POST",
  headers: {
    "Content-Type": "application/json",
    Authorization: `Bearer ${session.access_token}`,
  },
  body: JSON.stringify({ store_id: currentStore.id, corpus_text: fileContent }),
});
// Ler SSE linha-a-linha (mesmo padrão do streaming de chat documentado)
```

---

## 5. Onde usar o conhecimento (opcional, na Sophia)

A pedido do usuário, foco está no **supervisor-agent** (Cérebro) usar como contexto. Não vou injetar no `whatsapp-reply-scheduler` (Sophia) automaticamente — o conhecimento melhora a Sophia **indiretamente** quando o Cérebro extrai regras melhores e atualiza o `ai_system_prompt`. Se depois o usuário quiser injeção direta na Sophia, é uma mudança pequena.

---

## 6. Considerações técnicas

- **Custo / tempo:** ~74 chamadas de IA + 1 de consolidação. Com Lovable AI Gateway (gemini-2.5-flash) é rápido e barato. Aviso o usuário no UI: "Pode levar 3–5 minutos".
- **Re-analisar** simplesmente sobrescreve as 3 colunas — sem histórico de versões (não pedido).
- **Limpar conhecimento** seta as 3 colunas para `NULL` / `0`.
- **Modelo:** prefiro `google/gemini-2.5-flash` (Lovable AI) por padrão — rápido, sem custo de API key extra. Anthropic como fallback se a chave estiver configurada e o usuário quiser. (O usuário pediu Claude `claude-sonnet-4-20250514`; vou usar Anthropic se a key existir, senão Lovable AI Gateway. Posso confirmar essa preferência se quiser.)

---

## Arquivos que serão criados/modificados

| Arquivo | Ação |
|---|---|
| `supabase/migrations/<timestamp>_corpus_knowledge.sql` | criar (ALTER TABLE) |
| `supabase/functions/analyze-corpus/index.ts` | criar |
| `supabase/functions/supervisor-agent/index.ts` | editar (injetar corpusContext) |
| `src/pages/AIAgent.tsx` | editar (nova aba "Corpus") |

Nada mais será alterado.

---

## Próximo passo

Confirme o plano e eu implemento. Se quiser, antes de implementar posso confirmar 2 detalhes:
1. Provedor de IA preferido para a análise (Anthropic Claude se key existir, ou direto Lovable AI Gateway)?
2. Devo também copiar o `training_dataset.txt` para o projeto, ou ele só vai ser usado via upload pela aba "Corpus"? (Recomendo só via upload — não polui o repo com 14k linhas.)
