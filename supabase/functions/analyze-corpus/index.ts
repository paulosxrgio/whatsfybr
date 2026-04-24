import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const BATCH_SIZE = 50;
const SLEEP_MS = 250;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

type Pair = { intent: string; sentiment: string; cliente: string; agente: string };

function parseCorpus(text: string): Pair[] {
  const pairs: Pair[] = [];
  const lines = text.split(/\r?\n/);
  let i = 0;
  while (i < lines.length) {
    const header = lines[i];
    const m = header.match(/^\[\d+\]\s*intent=(\S+)\s*\|\s*sentiment=(\S+)/i);
    if (!m) { i++; continue; }
    const intent = m[1];
    const sentiment = m[2];
    let cliente = "";
    let agente = "";
    // procurar próximas linhas CLIENTE: e AGENTE:
    for (let j = i + 1; j < Math.min(i + 8, lines.length); j++) {
      const l = lines[j];
      if (l.startsWith("CLIENTE:")) cliente = l.replace(/^CLIENTE:\s*/, "").trim();
      else if (l.startsWith("AGENTE:")) agente = l.replace(/^AGENTE:\s*/, "").trim();
      if (cliente && agente) { i = j + 1; break; }
      if (j === i + 7) i = j;
    }
    if (cliente || agente) pairs.push({ intent, sentiment, cliente, agente });
    else i++;
  }
  return pairs;
}

const BATCH_SYSTEM_PROMPT = `Você é o Cérebro, supervisor de uma IA de atendimento WhatsApp para e-commerce brasileiro.

Analise os pares de conversa CLIENTE/AGENTE e extraia:

PADRÕES DE CLIENTES: comportamentos recorrentes, inseguranças, dúvidas típicas
TÉCNICAS EFICAZES: abordagens do agente que resolvem bem / desescalam
ERROS A EVITAR: respostas que prolongam o problema ou irritam o cliente
VOCABULÁRIO IDEAL: expressões que funcionam no e-commerce BR informal
POR INTENT: para cada tipo de situação (saudacao, reclamacao, troca, prazo, produto), qual é a estrutura de resposta ideal

Seja específico e cirúrgico. Não generalize. Extraia padrões reais do texto.

Responda APENAS em JSON válido no formato:
{
  "padroes_clientes": ["..."],
  "tecnicas_eficazes": ["..."],
  "erros_evitar": ["..."],
  "vocabulario_ideal": ["..."],
  "por_intent": { "saudacao": "...", "reclamacao": "...", "prazo_entrega": "...", "troca_devolucao": "...", "duvida_produto": "..." }
}`;

const CONSOLIDATION_SYSTEM_PROMPT = `Você é o Cérebro consolidando análises de múltiplos lotes de conversas reais de e-commerce brasileiro.

Receberá vários JSONs parciais. Sua tarefa é PRODUZIR UM ÚNICO documento markdown consolidado, deduplicado e cirúrgico, com estas seções:

# Conhecimento Extraído de Conversas Reais

## Padrões de Clientes (top 15)
- ...

## Técnicas Eficazes (top 15)
- ...

## Erros a Evitar (top 15)
- ...

## Vocabulário Ideal
- ...

## Estruturas por Intent
### Saudação
...
### Reclamação
...
### Prazo de Entrega
...
### Troca/Devolução
...
### Dúvida de Produto
...

Regras:
- Deduplique itens parecidos (escolha a redação mais clara).
- Priorize padrões que aparecem em MÚLTIPLOS lotes.
- Seja conciso. Cada bullet em 1 linha.
- Em "por intent", dê uma estrutura de resposta acionável (3-5 linhas).
- Responda APENAS com o markdown, sem cercas \`\`\` em volta.`;

async function callAI(opts: {
  apiKey: string;
  provider: "lovable" | "anthropic";
  system: string;
  user: string;
  jsonMode: boolean;
  model?: string;
  maxTokens?: number;
}): Promise<string> {
  const { apiKey, provider, system, user, jsonMode, model, maxTokens } = opts;
  if (provider === "anthropic") {
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: model || "claude-sonnet-4-20250514",
        max_tokens: maxTokens || 2000,
        system,
        messages: [{ role: "user", content: user }],
      }),
    });
    if (!res.ok) throw new Error(`Anthropic ${res.status}: ${await res.text()}`);
    const data = await res.json();
    return data.content?.[0]?.text || "";
  }
  // Lovable AI Gateway
  const res = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model: model || "google/gemini-2.5-flash",
      messages: [
        { role: "system", content: system },
        { role: "user", content: user },
      ],
      ...(jsonMode ? { response_format: { type: "json_object" } } : {}),
      max_tokens: maxTokens || 2000,
    }),
  });
  if (res.status === 429) throw new Error("Rate limit excedido. Tente novamente em alguns segundos.");
  if (res.status === 402) throw new Error("Créditos insuficientes na workspace Lovable AI.");
  if (!res.ok) throw new Error(`Lovable AI ${res.status}: ${await res.text()}`);
  const data = await res.json();
  return data.choices?.[0]?.message?.content || "";
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const { store_id, corpus_text } = await req.json();
    if (!store_id || typeof store_id !== "string") {
      return new Response(JSON.stringify({ error: "store_id obrigatório" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    if (!corpus_text || typeof corpus_text !== "string" || corpus_text.length < 100) {
      return new Response(JSON.stringify({ error: "corpus_text inválido" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    // Decidir provider
    const { data: settings } = await supabase
      .from("settings")
      .select("anthropic_api_key")
      .eq("store_id", store_id)
      .maybeSingle();

    const lovableKey = Deno.env.get("LOVABLE_API_KEY");
    let provider: "lovable" | "anthropic";
    let apiKey: string;
    let model: string | undefined;
    if (settings?.anthropic_api_key) {
      provider = "anthropic"; apiKey = settings.anthropic_api_key; model = "claude-sonnet-4-20250514";
    } else if (lovableKey) {
      provider = "lovable"; apiKey = lovableKey; model = "google/gemini-2.5-flash";
    } else {
      return new Response(JSON.stringify({ error: "Nenhum provider de IA configurado" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const pairs = parseCorpus(corpus_text);
    if (pairs.length === 0) {
      return new Response(JSON.stringify({ error: "Nenhum par CLIENTE/AGENTE encontrado no corpus" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const totalBatches = Math.ceil(pairs.length / BATCH_SIZE);

    // Stream SSE de progresso
    const stream = new ReadableStream({
      async start(controller) {
        const enc = new TextEncoder();
        const send = (obj: any) => controller.enqueue(enc.encode(`data: ${JSON.stringify(obj)}\n\n`));

        try {
          send({ type: "start", total_pairs: pairs.length, total_batches: totalBatches, provider });

          const partials: any[] = [];
          for (let b = 0; b < totalBatches; b++) {
            const slice = pairs.slice(b * BATCH_SIZE, (b + 1) * BATCH_SIZE);
            const userMsg = slice
              .map((p, idx) =>
                `--- Par ${b * BATCH_SIZE + idx + 1} [intent=${p.intent} sentiment=${p.sentiment}] ---\nCLIENTE: ${p.cliente}\nAGENTE: ${p.agente}`
              )
              .join("\n\n");

            try {
              const txt = await callAI({
                apiKey, provider, model,
                system: BATCH_SYSTEM_PROMPT,
                user: userMsg,
                jsonMode: true,
                maxTokens: 1500,
              });
              const cleaned = txt.replace(/```json|```/g, "").trim();
              const parsed = JSON.parse(cleaned);
              partials.push(parsed);
              send({ type: "progress", current: b + 1, total: totalBatches, message: `Lote ${b + 1}/${totalBatches} processado` });
            } catch (err) {
              console.error(`[analyze-corpus] lote ${b + 1} falhou:`, err);
              send({ type: "progress", current: b + 1, total: totalBatches, message: `Lote ${b + 1}/${totalBatches} falhou (continuando)` });
            }

            if (b < totalBatches - 1) await sleep(SLEEP_MS);
          }

          if (partials.length === 0) {
            send({ type: "error", error: "Nenhum lote foi processado com sucesso" });
            controller.close();
            return;
          }

          // Consolidação
          send({ type: "progress", current: totalBatches, total: totalBatches, message: "Consolidando insights..." });
          const consolidationInput = `Recebi ${partials.length} análises parciais (cada uma de ~50 conversas). Consolide em um único documento markdown.\n\n${JSON.stringify(partials, null, 2).slice(0, 60000)}`;
          const finalMd = await callAI({
            apiKey, provider, model,
            system: CONSOLIDATION_SYSTEM_PROMPT,
            user: consolidationInput,
            jsonMode: false,
            maxTokens: 4000,
          });

          send({ type: "progress", current: totalBatches, total: totalBatches, message: "Salvando na memória do Cérebro..." });

          const { error: upErr } = await supabase
            .from("settings")
            .update({
              cerebro_corpus_knowledge: finalMd.trim(),
              corpus_analyzed_at: new Date().toISOString(),
              corpus_pairs_analyzed: pairs.length,
            })
            .eq("store_id", store_id);

          if (upErr) {
            send({ type: "error", error: `Erro ao salvar: ${upErr.message}` });
            controller.close();
            return;
          }

          send({
            type: "done",
            pairs_analyzed: pairs.length,
            batches_processed: partials.length,
            knowledge_length: finalMd.length,
          });
          controller.close();
        } catch (e) {
          console.error("[analyze-corpus] erro:", e);
          send({ type: "error", error: e instanceof Error ? e.message : "unknown" });
          controller.close();
        }
      },
    });

    return new Response(stream, {
      headers: { ...corsHeaders, "Content-Type": "text/event-stream", "Cache-Control": "no-cache" },
    });
  } catch (e) {
    console.error("[analyze-corpus] fatal:", e);
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : "unknown" }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
