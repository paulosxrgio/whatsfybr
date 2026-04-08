import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    const { data: queue } = await supabase
      .from("auto_reply_queue")
      .select("*")
      .eq("status", "pending")
      .lte("scheduled_for", new Date().toISOString())
      .order("scheduled_for")
      .limit(10);

    if (!queue || queue.length === 0) {
      return new Response(JSON.stringify({ processed: 0 }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    let processed = 0;

    for (const item of queue) {
      try {
        await supabase.from("auto_reply_queue").update({ status: "processing" }).eq("id", item.id);

        const { data: settings } = await supabase.from("settings").select("*").eq("store_id", item.store_id).single();
        if (!settings) { await supabase.from("auto_reply_queue").update({ status: "failed" }).eq("id", item.id); continue; }
        if (!settings.ai_is_active) { await supabase.from("auto_reply_queue").update({ status: "skipped" }).eq("id", item.id); continue; }

        // Fetch account-level AI settings
        const { data: storeData } = await supabase.from("stores").select("user_id").eq("id", item.store_id).single();
        if (!storeData) { await supabase.from("auto_reply_queue").update({ status: "failed" }).eq("id", item.id); continue; }

        const { data: acctSettings } = await supabase.from("account_settings").select("*").eq("user_id", storeData.user_id).maybeSingle();
        const aiProvider = acctSettings?.ai_provider || "openai";
        const aiModel = acctSettings?.ai_model || "gpt-4o";
        const openaiApiKey = acctSettings?.openai_api_key || "";
        const anthropicApiKey = acctSettings?.anthropic_api_key || "";

        const { data: ticket } = await supabase.from("tickets").select("*").eq("id", item.ticket_id).single();
        if (!ticket) { await supabase.from("auto_reply_queue").update({ status: "failed" }).eq("id", item.id); continue; }

        const { data: messages } = await supabase
          .from("messages")
          .select("content, direction, message_type, created_at")
          .eq("ticket_id", item.ticket_id)
          .order("created_at", { ascending: true })
          .limit(10);

        const { data: memory } = await supabase
          .from("customer_memory")
          .select("*")
          .eq("store_id", item.store_id)
          .eq("customer_phone", ticket.customer_phone)
          .maybeSingle();

        const storeName = (await supabase.from("stores").select("name").eq("id", item.store_id).single()).data?.name || "Loja";

        const defaultPrompt = `Você é Sophia, atendente de suporte da loja ${storeName} via WhatsApp.\n\nIDIOMA: Sempre responda em português brasileiro.\n\nTOM: Simpático, humano, caloroso e direto. Como uma atendente real de WhatsApp, não um robô. Use linguagem natural, pode usar emojis com moderação (1 por mensagem no máximo).\n\nFORMATO:\n- Mensagens curtas. WhatsApp não é email.\n- Máximo 3 parágrafos curtos por resposta.\n- Nunca use listas com bullet points.\n- Nunca use Markdown.\n- Para agradecimentos simples, responda com 1 linha apenas.\n\nAssine sempre: Abraços, Sophia`;

        const systemPrompt = (settings.ai_system_prompt || defaultPrompt)
          .replace("${storeName}", storeName);

        const chatMessages = [
          { role: "system", content: systemPrompt },
        ];

        if (memory) {
          chatMessages.push({
            role: "system",
            content: `Contexto do cliente: Nome: ${memory.customer_name || "desconhecido"}, Idioma: ${memory.preferred_language}, Último sentimento: ${memory.last_sentiment || "neutro"}, Total interações: ${memory.total_interactions}${memory.notes ? `, Notas: ${memory.notes}` : ""}`,
          });
        }

        if (messages) {
          for (const msg of messages) {
            chatMessages.push({
              role: msg.direction === "inbound" ? "user" : "assistant",
              content: msg.content || "[mídia]",
            });
          }
        }

        // Call AI
        let responseText = "";

        if (aiProvider === "openai") {
          const res = await fetch("https://api.openai.com/v1/chat/completions", {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "Authorization": `Bearer ${openaiApiKey}`,
            },
            body: JSON.stringify({
              model: aiModel,
              messages: chatMessages,
              max_tokens: 500,
            }),
          });
          const data = await res.json();
          responseText = data.choices?.[0]?.message?.content || "";
        } else if (aiProvider === "anthropic") {
          const systemMsg = chatMessages.filter(m => m.role === "system").map(m => m.content).join("\n\n");
          const userMsgs = chatMessages.filter(m => m.role !== "system");
          const res = await fetch("https://api.anthropic.com/v1/messages", {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "x-api-key": anthropicApiKey,
              "anthropic-version": "2023-06-01",
            },
            body: JSON.stringify({
              model: aiModel,
              max_tokens: 500,
              system: systemMsg,
              messages: userMsgs,
            }),
          });
          const data = await res.json();
          responseText = data.content?.[0]?.text || "";
        }

        if (!responseText) {
          await supabase.from("auto_reply_queue").update({ status: "failed" }).eq("id", item.id);
          continue;
        }

        // Detect sentiment
        let sentiment = "neutral";
        const lowerContent = (messages?.slice(-1)[0]?.content || "").toLowerCase();
        if (lowerContent.match(/(obrigad|perfeito|ótimo|excelente|adorei|amei|maravilh)/)) sentiment = "positive";
        else if (lowerContent.match(/(demora|atraso|problema|errado|defeito|não funciona)/)) sentiment = "frustrated";
        else if (lowerContent.match(/(absurd|vergonha|péssimo|horrível|nunca mais|processsar|procon)/)) sentiment = "angry";

        // Typing indicator - start composing
        const zapiBaseUrl = `https://api.z-api.io/instances/${settings.zapi_instance_id}/token/${settings.zapi_token}`;
        const zapiHeaders = {
          "Content-Type": "application/json",
          "Client-Token": settings.zapi_client_token || "",
        };

        await fetch(`${zapiBaseUrl}/send-chat-state`, {
          method: "POST",
          headers: zapiHeaders,
          body: JSON.stringify({ phone: ticket.customer_phone, chatState: "composing" }),
        });

        // Wait the configured delay
        const delaySeconds = settings.ai_response_delay || 2;
        await new Promise(r => setTimeout(r, delaySeconds * 1000));

        // Send via Z-API
        await fetch(`${zapiBaseUrl}/send-text`, {
          method: "POST",
          headers: zapiHeaders,
          body: JSON.stringify({ phone: ticket.customer_phone, message: responseText }),
        });

        // Stop typing indicator
        await fetch(`${zapiBaseUrl}/send-chat-state`, {
          method: "POST",
          headers: zapiHeaders,
          body: JSON.stringify({ phone: ticket.customer_phone, chatState: "paused" }),
        });

        // Save outbound message
        await supabase.from("messages").insert({
          ticket_id: item.ticket_id,
          store_id: item.store_id,
          content: responseText,
          direction: "outbound",
          message_type: "text",
        });

        // Update ticket
        await supabase.from("tickets").update({
          last_message_at: new Date().toISOString(),
          sentiment,
        }).eq("id", item.ticket_id);

        // Update customer memory
        await supabase.from("customer_memory").upsert({
          store_id: item.store_id,
          customer_phone: ticket.customer_phone,
          last_sentiment: sentiment,
          total_interactions: (memory?.total_interactions || 0) + 1,
          updated_at: new Date().toISOString(),
        }, { onConflict: "store_id,customer_phone" });

        // Mark done
        await supabase.from("auto_reply_queue").update({ status: "done" }).eq("id", item.id);
        processed++;
      } catch (e) {
        console.error("Queue item error:", e);
        await supabase.from("auto_reply_queue").update({ status: "failed" }).eq("id", item.id);
      }
    }

    return new Response(JSON.stringify({ processed }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("scheduler error:", e);
    return new Response(JSON.stringify({ error: e.message }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
