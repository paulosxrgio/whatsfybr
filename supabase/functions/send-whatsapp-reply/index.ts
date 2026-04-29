import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const { ticket_id, message, store_id, source } = await req.json();

    if (!ticket_id || !message || !store_id) {
      return new Response(JSON.stringify({ error: "ticket_id, message, store_id required" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const messageSource: "manual" | "ai" = source === "ai" || source === "ai_generated" ? "ai" : "manual";

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    const { data: ticket } = await supabase.from("tickets").select("customer_phone").eq("id", ticket_id).single();
    if (!ticket) throw new Error("Ticket not found");

    const { data: settings } = await supabase.from("settings").select("*").eq("store_id", store_id).single();
    if (!settings) throw new Error("Settings not found");

    const cleanPhone = ticket.customer_phone.replace(/\D/g, "");

    const zapiUrl = `https://api.z-api.io/instances/${settings.zapi_instance_id}/token/${settings.zapi_token}/send-text`;
    const zapiRes = await fetch(zapiUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Client-Token": settings.zapi_client_token || "",
      },
      body: JSON.stringify({ phone: cleanPhone, message }),
    });

    const zapiBody = await zapiRes.json().catch(() => ({} as any));
    console.log(`[Z-API RESPONSE] status: ${zapiRes.status}, body: ${JSON.stringify(zapiBody)}`);

    if (!zapiRes.ok || zapiBody?.error) {
      console.error("[Z-API FAIL]", zapiRes.status, zapiBody);
      throw new Error(`Z-API send failed: ${JSON.stringify(zapiBody)}`);
    }

    await supabase.from("messages").insert({
      ticket_id,
      store_id,
      content: message,
      direction: "outbound",
      message_type: "text",
      source: messageSource,
      zapi_message_id: zapiBody?.zaapId || zapiBody?.messageId || zapiBody?.id || null,
    });

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

    return new Response(JSON.stringify({ ok: true, source: messageSource }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("send-whatsapp-reply error:", e);
    return new Response(JSON.stringify({ error: e.message }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
