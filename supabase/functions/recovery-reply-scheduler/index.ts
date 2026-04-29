// Processa a recovery_reply_queue: 1 item por execução com rate limit de 120s POR LOJA.
// - Pega o primeiro pending com scheduled_for <= now().
// - Garante que nenhuma mensagem de retomada da MESMA loja saiu nos últimos 120s
//   (proteção do número novo).
// - Gera resposta via OpenAI baseada no histórico do ticket.
// - Concatena prefixo de retomada + resposta personalizada.
// - Envia através do send-whatsapp-reply (única porta de saída para Z-API).
// - Marca tickets.recovery_message_sent_at para evitar duplicidade em 24h.
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};
const json = (b: unknown, status = 200) =>
  new Response(JSON.stringify(b), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });

const RATE_LIMIT_SECONDS = 120;

const RECOVERY_PREFIX =
  "Olá! Tudo bem? 😊\n\n" +
  "Aqui é a Sophia, assistente virtual da Adorisse.\n\n" +
  "Peço desculpas pela demora no retorno. Já estou dando continuidade ao seu atendimento e vou te ajudar com isso agora.";

async function callSendWhatsappReply(args: { ticket_id: string; store_id: string; message: string; source: string }) {
  const url = `${Deno.env.get("SUPABASE_URL")}/functions/v1/send-whatsapp-reply`;
  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")}`,
    },
    body: JSON.stringify(args),
  });
  const text = await res.text();
  let body: any = {};
  try { body = JSON.parse(text || "{}"); } catch { body = { raw: text }; }
  return { http_status: res.status, ...body };
}

async function generatePersonalizedReply(opts: {
  openaiApiKey: string;
  model: string;
  storeName: string;
  systemPromptExtra?: string | null;
  history: string;
  lastInbound: string;
}): Promise<string> {
  const { openaiApiKey, model, storeName, systemPromptExtra, history, lastInbound } = opts;

  const instructions =
    `Você é Sophia, atendente virtual da loja ${storeName}.\n` +
    `Você está RETOMANDO um atendimento que ficou sem resposta. ` +
    `O texto de desculpas/apresentação será adicionado AUTOMATICAMENTE ANTES da sua resposta — ` +
    `NÃO se apresente, NÃO peça desculpas pela demora, NÃO repita "Olá" nem "Sou a Sophia".\n` +
    `Sua tarefa: responder DIRETAMENTE a dúvida real do cliente com base no histórico.\n\n` +
    `Regras:\n` +
    `- Tom educado, humano, próximo. Sem jargão.\n` +
    `- Português do Brasil.\n` +
    `- Máximo 4 frases curtas.\n` +
    `- Se for dúvida sobre rastreio/pedido/troca, responda objetivamente o que já dá para responder com o histórico.\n` +
    `- Se faltar info do pedido, peça apenas o número do pedido ou e-mail.\n` +
    `- Não use links.\n` +
    `- Não use linguagem promocional.\n` +
    `- Não repita o cumprimento.\n` +
    (systemPromptExtra ? `\nContexto da loja:\n${systemPromptExtra}\n` : "");

  const input =
    `HISTÓRICO RECENTE:\n${history}\n\n` +
    `ÚLTIMA MENSAGEM DO CLIENTE:\n${lastInbound}\n\n` +
    `Escreva agora APENAS a resposta personalizada (sem cumprimento, sem desculpas).`;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 25000);
  try {
    const res = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: { "Content-Type": "application/json", "Authorization": `Bearer ${openaiApiKey}` },
      body: JSON.stringify({
        model,
        instructions,
        input,
        store: false,
        max_output_tokens: 350,
      }),
      signal: controller.signal,
    });
    clearTimeout(timeout);
    const data = await res.json();
    if (!res.ok) throw new Error(`OpenAI ${res.status}: ${data.error?.message || "erro"}`);
    const text = (data.output_text || data.output?.[0]?.content?.[0]?.text || "").trim();
    return text;
  } catch (e: any) {
    clearTimeout(timeout);
    throw e;
  }
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    // Pega o próximo item pending pronto (1 por execução, ordem cronológica).
    const { data: nextItems } = await supabase
      .from("recovery_reply_queue")
      .select("*")
      .eq("status", "pending")
      .lte("scheduled_for", new Date().toISOString())
      .order("scheduled_for", { ascending: true })
      .limit(1);

    if (!nextItems || nextItems.length === 0) {
      return json({ ok: true, processed: 0, reason: "no_pending" });
    }

    const item = nextItems[0];

    // Rate limit por loja: nada enviado nos últimos 120s
    const since = new Date(Date.now() - RATE_LIMIT_SECONDS * 1000).toISOString();
    const { data: recentRecovery } = await supabase
      .from("messages")
      .select("created_at, ticket_id")
      .eq("store_id", item.store_id)
      .eq("source", "recovery_ai")
      .gt("created_at", since)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (recentRecovery) {
      const nextAt = new Date(new Date(recentRecovery.created_at).getTime() + RATE_LIMIT_SECONDS * 1000).toISOString();
      console.log(`[RECOVERY RATE LIMIT] ${JSON.stringify({ next_ticket_scheduled_for: nextAt, delay_seconds: RATE_LIMIT_SECONDS })}`);
      // Reagenda este item para depois do limite
      await supabase.from("recovery_reply_queue")
        .update({ scheduled_for: nextAt, updated_at: new Date().toISOString() })
        .eq("id", item.id);
      return json({ ok: true, processed: 0, rate_limited: true, rescheduled_for: nextAt });
    }

    // Lock atômico
    const { data: locked } = await supabase
      .from("recovery_reply_queue")
      .update({ status: "processing", attempts: (item.attempts || 0) + 1, updated_at: new Date().toISOString() })
      .eq("id", item.id)
      .eq("status", "pending")
      .select("id");
    if (!locked || locked.length === 0) {
      return json({ ok: true, processed: 0, reason: "lost_race" });
    }

    const { data: ticket } = await supabase.from("tickets").select("*").eq("id", item.ticket_id).maybeSingle();
    if (!ticket || ticket.status !== "open" || ticket.ai_paused) {
      await supabase.from("recovery_reply_queue").update({ status: "skipped", last_error: "ticket_not_eligible", updated_at: new Date().toISOString() }).eq("id", item.id);
      return json({ ok: true, processed: 0, reason: "ticket_not_eligible" });
    }

    if (ticket.recovery_message_sent_at && Date.now() - new Date(ticket.recovery_message_sent_at).getTime() < 24 * 3600 * 1000) {
      await supabase.from("recovery_reply_queue").update({ status: "skipped", last_error: "already_sent_24h", updated_at: new Date().toISOString() }).eq("id", item.id);
      return json({ ok: true, processed: 0, reason: "already_sent_24h" });
    }

    console.log(`[RECOVERY ITEM PROCESSING] ${JSON.stringify({ ticket_id: item.ticket_id, store_id: item.store_id, customer_phone: ticket.customer_phone })}`);

    // Settings da loja + chave OpenAI da conta
    const { data: settings } = await supabase.from("settings").select("*").eq("store_id", item.store_id).maybeSingle();
    const { data: storeRow } = await supabase.from("stores").select("user_id, name").eq("id", item.store_id).single();
    const { data: acct } = await supabase.from("account_settings").select("*").eq("user_id", storeRow!.user_id).maybeSingle();
    const openaiApiKey = acct?.openai_api_key || "";
    const model = acct?.ai_model || "gpt-4o-mini";

    if (!openaiApiKey) {
      await supabase.from("recovery_reply_queue").update({ status: "failed", last_error: "openai_key_missing", updated_at: new Date().toISOString() }).eq("id", item.id);
      return json({ ok: false, error: "openai_key_missing" });
    }

    // Histórico (últimas 12 mensagens)
    const { data: history } = await supabase
      .from("messages")
      .select("content, direction, message_type, created_at")
      .eq("ticket_id", item.ticket_id)
      .order("created_at", { ascending: true })
      .limit(20);

    const formattedHistory = (history || [])
      .slice(-12)
      .map(m => {
        const author = m.direction === "outbound" ? "SOPHIA" : "CLIENTE";
        const content = m.message_type === "audio" ? `[áudio: ${m.content || ""}]` : (m.content || "[mídia]");
        return `${author}: ${content}`;
      })
      .join("\n")
      .slice(-2500);

    const lastInbound = (history || [])
      .filter(m => m.direction === "inbound")
      .slice(-3)
      .map(m => m.content || "[mídia]")
      .join("\n");

    let personalized = "";
    try {
      personalized = await generatePersonalizedReply({
        openaiApiKey,
        model,
        storeName: storeRow!.name,
        systemPromptExtra: settings?.ai_system_prompt,
        history: formattedHistory,
        lastInbound,
      });
    } catch (e: any) {
      console.error("[RECOVERY AI ERROR]", e?.message);
      await supabase.from("recovery_reply_queue").update({
        status: "pending",
        last_error: `ai_error: ${e?.message || e}`,
        scheduled_for: new Date(Date.now() + 60_000).toISOString(),
        updated_at: new Date().toISOString(),
      }).eq("id", item.id);
      return json({ ok: false, error: "ai_error", detail: e?.message });
    }

    if (!personalized || personalized.length < 5) {
      personalized = "Pode me confirmar o número do seu pedido ou o e-mail usado na compra para eu te ajudar com isso?";
    }

    console.log(`[RECOVERY AI RESPONSE GENERATED] ${JSON.stringify({ ticket_id: item.ticket_id, response_length: personalized.length })}`);

    const finalMessage = `${RECOVERY_PREFIX}\n\n${personalized}`;

    const sendResult = await callSendWhatsappReply({
      ticket_id: item.ticket_id,
      store_id: item.store_id,
      message: finalMessage,
      source: "recovery_ai",
    });

    console.log(`[RECOVERY SEND RESULT] ${JSON.stringify({ ticket_id: item.ticket_id, ok: sendResult.ok, zapi_message_id: sendResult.zapi_message_id, error: sendResult.error })}`);

    if (!sendResult.ok) {
      await supabase.from("recovery_reply_queue").update({
        status: "failed",
        last_error: sendResult.error || `http_${sendResult.http_status}`,
        updated_at: new Date().toISOString(),
      }).eq("id", item.id);
      return json({ ok: false, error: sendResult.error || "send_failed", detail: sendResult });
    }

    await supabase.from("recovery_reply_queue").update({
      status: "completed",
      updated_at: new Date().toISOString(),
    }).eq("id", item.id);

    await supabase.from("tickets").update({
      recovery_message_sent_at: new Date().toISOString(),
    }).eq("id", item.ticket_id);

    const nextSlot = new Date(Date.now() + RATE_LIMIT_SECONDS * 1000).toISOString();
    console.log(`[RECOVERY RATE LIMIT] ${JSON.stringify({ next_ticket_scheduled_for: nextSlot, delay_seconds: RATE_LIMIT_SECONDS })}`);

    return json({ ok: true, processed: 1, ticket_id: item.ticket_id, zapi_message_id: sendResult.zapi_message_id });
  } catch (e: any) {
    console.error("recovery-reply-scheduler error:", e);
    return json({ ok: false, error: e?.message || "Erro inesperado" });
  }
});
