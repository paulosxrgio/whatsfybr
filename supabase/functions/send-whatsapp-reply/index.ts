// Padrão Zaply: simples, sem helper, sem checagem de /status, sem @lid.
// Body exato { phone, message } como no projeto Zaply que funciona.
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const json = (body: Record<string, unknown>, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const { ticket_id, message, store_id, source } = await req.json();

    console.log("[SEND-WHATSAPP-REPLY INPUT]", JSON.stringify({
      ticket_id, store_id, source,
      message_length: typeof message === "string" ? message.length : 0,
    }));

    if (!ticket_id || !message || !store_id) {
      return json({ ok: false, error: "ticket_id, message, store_id required" }, 200);
    }

    const messageSource: "manual" | "ai" =
      source === "ai" || source === "ai_generated" || source === "ai_scheduler" || source === "ai_handoff"
        ? "ai"
        : "manual";

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    const { data: ticket } = await supabase
      .from("tickets")
      .select("customer_phone")
      .eq("id", ticket_id)
      .eq("store_id", store_id)
      .single();
    if (!ticket) return json({ ok: false, error: "Ticket não encontrado" }, 200);

    const { data: settings } = await supabase
      .from("settings")
      .select("zapi_instance_id, zapi_token, zapi_client_token")
      .eq("store_id", store_id)
      .single();
    if (!settings) return json({ ok: false, error: "Configurações da loja não encontradas" }, 200);

    console.log("[ZAPI CREDENTIAL CHECK]", JSON.stringify({
      has_instance_id: Boolean(settings.zapi_instance_id),
      has_token: Boolean(settings.zapi_token),
      has_client_token: Boolean(settings.zapi_client_token),
      instance_id: settings.zapi_instance_id,
    }));

    if (!settings.zapi_instance_id || !settings.zapi_token) {
      return json({ ok: false, error: "Z-API não configurada (instance_id/token ausentes)" }, 200);
    }

    const cleanPhone = String(ticket.customer_phone).replace(/\D/g, "");
    const zapiUrl = `https://api.z-api.io/instances/${settings.zapi_instance_id}/token/${settings.zapi_token}/send-text`;
    const payload = { phone: cleanPhone, message: String(message) };

    console.log("[ZAPI SEND REQUEST]", JSON.stringify({ phone: cleanPhone, body_sent: payload }));

    const zResp = await fetch(zapiUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(settings.zapi_client_token ? { "Client-Token": settings.zapi_client_token } : {}),
      },
      body: JSON.stringify(payload),
    });

    const rawText = await zResp.text();
    let respBody: any = {};
    try { respBody = JSON.parse(rawText || "{}"); } catch { respBody = { raw: rawText }; }

    console.log("[ZAPI SEND RESPONSE]", JSON.stringify({ http_status: zResp.status, body: respBody }));

    if (!zResp.ok) {
      return json({
        ok: false,
        error: respBody?.error || `Z-API retornou HTTP ${zResp.status}`,
        http_status: zResp.status,
        zapi_response: respBody,
      }, 200);
    }

    const messageId = respBody?.messageId || null;
    const zaapId = respBody?.zaapId || null;
    const zapiId = respBody?.id || null;
    const primaryId = messageId || zapiId || zaapId || null;

    const { data: savedMessage } = await supabase.from("messages").insert({
      ticket_id,
      store_id,
      content: String(message),
      direction: "outbound",
      message_type: "text",
      source: messageSource,
      zapi_message_id: primaryId,
      zapi_zaap_id: zaapId,
      zapi_id: zapiId,
      zapi_response: respBody,
      delivery_status: "sent_to_zapi",
      delivery_updated_at: new Date().toISOString(),
    }).select("id").single();

    console.log("[MESSAGE SAVED]", JSON.stringify({
      message_id: savedMessage?.id,
      zapi_message_id: primaryId,
      source: messageSource,
    }));

    await supabase.from("tickets")
      .update({ last_message_at: new Date().toISOString() })
      .eq("id", ticket_id);

    // Salvar exemplo de treinamento se for resposta humana
    if (messageSource === "manual") {
      try {
        const { data: recent } = await supabase
          .from("messages")
          .select("content, direction, message_type, created_at")
          .eq("ticket_id", ticket_id)
          .order("created_at", { ascending: false })
          .limit(8);

        const inboundMsgs = (recent || [])
          .filter((m: any) => m.direction === "inbound")
          .reverse()
          .slice(-4)
          .map((m: any) => {
            if (m.message_type === "image") return m.content || "[imagem]";
            if (m.message_type === "audio") return `[áudio: ${m.content || ""}]`;
            return m.content || "";
          })
          .filter(Boolean)
          .join("\n");

        if (inboundMsgs.trim().length > 0) {
          await supabase.from("training_examples").insert({
            store_id,
            ticket_id,
            customer_input: inboundMsgs.slice(0, 1500),
            ideal_response: String(message).slice(0, 2000),
            source: "human_operator",
          });
        }
      } catch (te) {
        console.error("[TRAINING ERROR]", te);
      }
    }

    return json({
      ok: true,
      source: messageSource,
      zapi_message_id: primaryId,
      zaapId,
      messageId,
      zapi_response: respBody,
    });
  } catch (e: any) {
    console.error("send-whatsapp-reply error:", e);
    return json({ ok: false, error: e?.message || "Erro inesperado" }, 200);
  }
});
