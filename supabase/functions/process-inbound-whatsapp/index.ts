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

    // Filter out Z-API LIDs (Linked IDs) — not real phone numbers
    if (phone.length > 13) {
      console.log(`Ignorando LID (não é telefone real): ${phone}`);
      return new Response(JSON.stringify({ ok: true, skipped: "lid_filtered" }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
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
    const { data: existingTicket } = await supabase
      .from("tickets")
      .select("id, customer_name")
      .eq("store_id", storeId)
      .eq("customer_phone", phone)
      .eq("status", "open")
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    let ticketId: string;

    if (existingTicket) {
      ticketId = existingTicket.id;
      await supabase
        .from("tickets")
        .update({
          last_message_at: new Date().toISOString(),
          customer_name: senderName || existingTicket.customer_name,
        })
        .eq("id", ticketId);
      console.log(`Ticket existente reutilizado: ${ticketId} para ${phone}`);
    } else {
      const { data: newTicket, error } = await supabase
        .from("tickets")
        .insert({
          store_id: storeId,
          customer_phone: phone,
          customer_name: senderName || "",
          status: "open",
          sentiment: "neutral",
          last_message_at: new Date().toISOString(),
        })
        .select()
        .single();

      if (error) {
        // Handle unique constraint violation (race condition) — re-fetch existing ticket
        if (error.code === "23505") {
          console.log(`Race condition detectada para ${phone}, buscando ticket existente`);
          const { data: raceTicket } = await supabase
            .from("tickets")
            .select("id")
            .eq("store_id", storeId)
            .eq("customer_phone", phone)
            .eq("status", "open")
            .limit(1)
            .maybeSingle();
          if (raceTicket) {
            ticketId = raceTicket.id;
          } else {
            console.error("Ticket não encontrado após race condition:", error);
            return new Response(JSON.stringify({ error: "Failed to resolve ticket" }), {
              status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
            });
          }
        } else {
          console.error("Erro ao criar ticket:", error);
          return new Response(JSON.stringify({ error: "Failed to create ticket" }), {
            status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }
      } else {
        ticketId = newTicket!.id;
      }
      console.log(`Ticket resolvido: ${ticketId} para ${phone}`);
    }

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
      ticket_id: ticketId,
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

    // Detectar email na mensagem (para captura inteligente)
    const emailRegex = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/;
    const emailFound = content?.match(emailRegex)?.[0] || null;

    // Update customer memory
    await supabase.from("customer_memory").upsert({
      store_id: storeId,
      customer_phone: phone,
      customer_name: senderName || null,
      ...(emailFound ? { customer_email: emailFound } : {}),
      total_interactions: 1,
      updated_at: new Date().toISOString(),
    }, { onConflict: "store_id,customer_phone" });

    if (emailFound) {
      console.log(`Email capturado para ${phone}: ${emailFound}`);
    }

    // ── BLOQUEIO DE SPAM: 8+ mensagens em 10 minutos ──
    const { count: recentCount } = await supabase
      .from("messages")
      .select("id", { count: "exact", head: true })
      .eq("ticket_id", ticketId)
      .eq("direction", "inbound")
      .gte("created_at", new Date(Date.now() - 10 * 60 * 1000).toISOString());

    if ((recentCount || 0) > 8) {
      console.log(`SPAM detectado para ticket ${ticketId} (${recentCount} msgs em 10min). Fechando ticket.`);
      await supabase.from("tickets").update({
        status: "closed",
        sentiment: "spam",
      }).eq("id", ticketId);

      // Cancelar qualquer item pendente na fila
      await supabase.from("auto_reply_queue")
        .update({ status: "skipped" })
        .eq("ticket_id", ticketId)
        .eq("status", "pending");

      return new Response(JSON.stringify({ ok: true, blocked: "spam", count: recentCount }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Check if AI is active and enqueue with smart wait
    const { data: settings } = await supabase
      .from("settings")
      .select("ai_is_active, ai_response_delay")
      .eq("store_id", storeId)
      .maybeSingle();

    if (settings?.ai_is_active) {
      const waitMs = 45000; // 45 seconds smart wait
      const newScheduledTime = new Date(Date.now() + waitMs).toISOString();

      // Check if there's already a pending queue item for this ticket
      const { data: existingQueue } = await supabase
        .from("auto_reply_queue")
        .select("id, message_count")
        .eq("ticket_id", ticketId)
        .eq("status", "pending")
        .maybeSingle();

      let updatedRows: any[] | null = null;
      if (existingQueue) {
        // Reset timer and increment counter — guard com status=pending para evitar race
        const { data: updated } = await supabase
          .from("auto_reply_queue")
          .update({
            scheduled_for: newScheduledTime,
            message_count: (existingQueue.message_count || 1) + 1,
            pending_since: new Date().toISOString(),
          })
          .eq("id", existingQueue.id)
          .eq("status", "pending")
          .select();

        updatedRows = updated || [];
        if (updatedRows.length > 0) {
          console.log(`[QUEUE RESET] ticket ${ticketId} — timer resetado. Mensagens: ${(existingQueue.message_count || 1) + 1}`);
        } else {
          console.log(`[QUEUE STALE] item ${existingQueue.id} já não está pending — criando novo`);
        }
      }

      if (!existingQueue || (updatedRows !== null && updatedRows.length === 0)) {
        // First message OR existing item já foi processado — create new queue item
        await supabase.from("auto_reply_queue").insert({
          ticket_id: ticketId,
          store_id: storeId,
          status: "pending",
          scheduled_for: newScheduledTime,
          pending_since: new Date().toISOString(),
          message_count: 1,
        });

        console.log(`[QUEUE CREATED] ticket ${ticketId} — agendado para ${newScheduledTime}`);
      }
    }

    console.log("=== WEBHOOK PROCESSADO COM SUCESSO ===", { ticket_id: ticketId });

    return new Response(JSON.stringify({ ok: true, ticket_id: ticketId }), {
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
