import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-store-id",
};

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const body = await req.json();

    console.log("=== WEBHOOK RECEBIDO ===");
    console.log("Body:", JSON.stringify(body));

    // Resolve store_id from multiple sources
    const url = new URL(req.url);
    let storeId = url.searchParams.get("store_id");

    if (!storeId) {
      storeId = req.headers.get("x-store-id");
    }

    if (!storeId && body.store_id) {
      storeId = body.store_id;
    }

    console.log("store_id resolved:", storeId);

    if (!storeId) {
      console.error("ERRO: store_id não encontrado");
      return new Response(JSON.stringify({ error: "Missing store_id" }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    // Ignorar mensagens enviadas por mim
    console.log("fromMe:", body.fromMe, "isGroup:", body.isGroup, "type:", body.type);
    if (body.fromMe === true) {
      return new Response(JSON.stringify({ ok: true, skipped: "fromMe" }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    if (body.isGroup === true) {
      return new Response(JSON.stringify({ ok: true, skipped: "group" }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    if (body.type !== "ReceivedCallback") {
      return new Response(JSON.stringify({ ok: true, skipped: "not_received_callback" }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const phone = body.phone ? String(body.phone).replace(/\D/g, "") : "";
    const senderName = body.senderName || body.chatName || "";
    const messageText = body.text?.message || "";
    const zapiMessageId = body.messageId || null;

    console.log("phone:", phone, "senderName:", senderName, "text:", messageText);

    // Detectar tipo de mídia
    let messageType = "text";
    let mediaUrl: string | null = null;

    if (body.image) { messageType = "image"; mediaUrl = body.image.imageUrl || null; }
    else if (body.audio) { messageType = "audio"; mediaUrl = body.audio.audioUrl || null; }
    else if (body.video) { messageType = "video"; mediaUrl = body.video.videoUrl || null; }
    else if (body.document) { messageType = "document"; mediaUrl = body.document.documentUrl || null; }

    if (!phone) {
      return new Response(JSON.stringify({ error: "phone required" }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    // Idempotência
    if (zapiMessageId) {
      const { data: existingMessage } = await supabase
        .from("messages")
        .select("id")
        .eq("zapi_message_id", zapiMessageId)
        .maybeSingle();

      if (existingMessage) {
        console.log("Mensagem duplicada, ignorando:", zapiMessageId);
        return new Response(JSON.stringify({ ok: true, skipped: "duplicate" }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }
    }

    // Find or create ticket
    let { data: ticket } = await supabase
      .from("tickets")
      .select("*")
      .eq("store_id", storeId)
      .eq("customer_phone", phone)
      .eq("status", "open")
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    console.log("Ticket existente:", ticket?.id || "nenhum");

    if (!ticket) {
      const { data: newTicket, error } = await supabase.from("tickets").insert({
        store_id: storeId,
        customer_phone: phone,
        customer_name: senderName || null,
        status: "open",
        sentiment: "neutral",
      }).select().single();

      if (error) {
        console.error("Erro ao criar ticket:", error);
        throw error;
      }
      ticket = newTicket;
      console.log("Novo ticket criado:", ticket.id);
    } else if (senderName && !ticket.customer_name) {
      await supabase.from("tickets").update({ customer_name: senderName }).eq("id", ticket.id);
    }

    // Update last_message_at
    await supabase.from("tickets").update({ last_message_at: new Date().toISOString() }).eq("id", ticket.id);

    // If audio, transcribe before saving
    let content = messageText;
    if (messageType === "audio" && mediaUrl) {
      try {
        const { data: storeData } = await supabase.from("stores").select("user_id").eq("id", storeId).single();
        const { data: acctSettings } = storeData
          ? await supabase.from("account_settings").select("openai_api_key").eq("user_id", storeData.user_id).maybeSingle()
          : { data: null };

        if (acctSettings?.openai_api_key) {
          const transcribeRes = await fetch(`${Deno.env.get("SUPABASE_URL")}/functions/v1/transcribe-audio`, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "Authorization": `Bearer ${Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")}`,
            },
            body: JSON.stringify({ audio_url: mediaUrl, openai_api_key: acctSettings.openai_api_key }),
          });
          const transcription = await transcribeRes.json();
          if (transcription?.text) {
            content = `🎤 ${transcription.text}`;
          } else {
            content = "🎤 [Áudio recebido - transcrição indisponível]";
          }
        } else {
          content = "🎤 [Áudio recebido - API key não configurada]";
        }
      } catch (e) {
        console.error("Transcription failed:", e);
        content = "🎤 [Áudio recebido]";
      }
    }

    // Save inbound message
    const { error: msgError } = await supabase.from("messages").insert({
      ticket_id: ticket.id,
      store_id: storeId,
      content,
      direction: "inbound",
      message_type: messageType,
      media_url: mediaUrl,
      zapi_message_id: zapiMessageId,
    });

    if (msgError) {
      console.error("Erro ao salvar mensagem:", msgError);
    } else {
      console.log("Mensagem salva com sucesso");
    }

    // Update customer memory
    await supabase.from("customer_memory").upsert({
      store_id: storeId,
      customer_phone: phone,
      customer_name: senderName || null,
      total_interactions: 1,
      updated_at: new Date().toISOString(),
    }, { onConflict: "store_id,customer_phone" });

    // Check if AI is active and enqueue
    const { data: settings } = await supabase
      .from("settings")
      .select("ai_is_active, ai_response_delay")
      .eq("store_id", storeId)
      .maybeSingle();

    if (settings?.ai_is_active) {
      const delay = settings.ai_response_delay || 2;
      const scheduledFor = new Date(Date.now() + delay * 1000).toISOString();
      await supabase.from("auto_reply_queue").insert({
        ticket_id: ticket.id,
        store_id: storeId,
        status: "pending",
        scheduled_for: scheduledFor,
      });
    }

    console.log("=== WEBHOOK PROCESSADO COM SUCESSO ===", { ticket_id: ticket.id });

    return new Response(JSON.stringify({ ok: true, ticket_id: ticket.id }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("process-inbound error:", e);
    return new Response(JSON.stringify({ error: e.message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
