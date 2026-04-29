import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { sendZapiText } from "../_shared/zapi.ts";

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

    if (!ticket_id || !message || !store_id) {
      return json({ ok: false, error: "ticket_id, message, store_id required" }, 200);
    }

    const messageSource: "manual" | "ai" = source === "ai" || source === "ai_generated" ? "ai" : "manual";

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    const { data: ticket } = await supabase
      .from("tickets")
      .select("customer_phone")
      .eq("id", ticket_id)
      .single();
    if (!ticket) return json({ ok: false, error: "Ticket não encontrado" }, 200);

    const { data: settings } = await supabase
      .from("settings")
      .select("*")
      .eq("store_id", store_id)
      .single();
    if (!settings) return json({ ok: false, error: "Configurações da loja não encontradas" }, 200);

    if (!settings.zapi_instance_id || !settings.zapi_token) {
      return json({ ok: false, error: "Z-API não configurada (instance_id/token ausentes)" }, 200);
    }

    const cleanPhone = ticket.customer_phone.replace(/\D/g, "");

    const zapiResult = await sendZapiText({
      instanceId: settings.zapi_instance_id,
      token: settings.zapi_token,
      clientToken: settings.zapi_client_token,
      phone: cleanPhone,
      message,
      origin: "manual",
    });

    if (!zapiResult.ok) {
      console.error("[Z-API FAIL]", zapiResult.status, zapiResult.zapi_response);
      return json({
        ok: false,
        error: zapiResult.error || "Falha ao enviar pela Z-API",
        zapi_response: zapiResult.zapi_response,
      }, 200);
    }

    const zapiId = zapiResult.zapi_message_id || null;
    if (!zapiId) {
      console.error("[Z-API FAIL] resposta sem zaapId/messageId/id:", zapiResult.zapi_response);
      return json({
        ok: false,
        error: "Z-API respondeu sem ID da mensagem — envio não confirmado",
        zapi_response: zapiResult.zapi_response,
      }, 200);
    }

    const { data: savedMessage } = await supabase.from("messages").insert({
      ticket_id,
      store_id,
      content: message,
      direction: "outbound",
      message_type: "text",
      source: messageSource,
      zapi_message_id: zapiId,
      zapi_zaap_id: zapiResult.zapi_zaap_id,
      zapi_id: zapiResult.zapi_id,
      zapi_response: zapiResult.zapi_response,
      delivery_status: "sent_to_zapi",
      delivery_updated_at: new Date().toISOString(),
    }).select("id").single();
    console.log("[MESSAGE SAVED]", JSON.stringify({ id: savedMessage?.id, origin: messageSource, zapi_message_id: zapiId, zapi_zaap_id: zapiResult.zapi_zaap_id, zapi_id: zapiResult.zapi_id }));

    await supabase.from("tickets").update({ last_message_at: new Date().toISOString() }).eq("id", ticket_id);

    // Se foi resposta manual humana → salvar como exemplo de treinamento
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
            ideal_response: message.slice(0, 2000),
            source: "human_operator",
          });
          console.log(`[TRAINING] novo exemplo salvo para loja ${store_id}`);
        }
      } catch (te) {
        console.error("[TRAINING ERROR]", te);
      }
    }

    return json({
      ok: true,
      source: messageSource,
      zapi_message_id: zapiId,
      zaapId: zapiResult.zaapId || null,
      messageId: zapiResult.messageId || null,
      zapi_response: zapiResult.zapi_response,
    });
  } catch (e: any) {
    console.error("send-whatsapp-reply error:", e);
    return json({ ok: false, error: e?.message || "Erro inesperado" }, 200);
  }
});
