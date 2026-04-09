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

        // Find the last outbound message to know where to start consolidating
        const { data: lastOutbound } = await supabase
          .from("messages")
          .select("created_at")
          .eq("ticket_id", item.ticket_id)
          .eq("direction", "outbound")
          .order("created_at", { ascending: false })
          .limit(1)
          .maybeSingle();

        const lastReplyAt = lastOutbound?.created_at || new Date(0).toISOString();

        // Fetch ALL inbound messages since last reply (consolidated)
        const { data: pendingMessages } = await supabase
          .from("messages")
          .select("content, direction, message_type, created_at")
          .eq("ticket_id", item.ticket_id)
          .eq("direction", "inbound")
          .gt("created_at", lastReplyAt)
          .order("created_at", { ascending: true });

        const consolidatedInput = pendingMessages
          ?.map((m, i) => {
            const prefix = pendingMessages.length > 1 ? `[mensagem ${i + 1}] ` : "";
            return `${prefix}${m.content || "[mídia]"}`;
          })
          .join("\n") || "";

        console.log(`Processando ${pendingMessages?.length || 0} mensagens consolidadas para ticket ${item.ticket_id}`);

        // Also fetch full conversation history for context
        const { data: messages } = await supabase
          .from("messages")
          .select("content, direction, message_type, created_at")
          .eq("ticket_id", item.ticket_id)
          .order("created_at", { ascending: true })
          .limit(20);

        const { data: memory } = await supabase
          .from("customer_memory")
          .select("*")
          .eq("store_id", item.store_id)
          .eq("customer_phone", ticket.customer_phone)
          .maybeSingle();

        const storeName = (await supabase.from("stores").select("name").eq("id", item.store_id).single()).data?.name || "Loja";

        const defaultPrompt = `Você é Sophia, atendente de suporte da loja ${storeName} via WhatsApp.

━━━━━━━━━━━━━━━━━━━━━━
PRINCÍPIOS FUNDAMENTAIS
━━━━━━━━━━━━━━━━━━━━━━

Você foi treinada nos padrões das melhores equipes de suporte do mundo — Apple, Spotify, Delta, Amazon. Seu objetivo não é apenas resolver o problema, é fazer o cliente se sentir ouvido e bem tratado.

REGRA DE OURO: Resolva o problema na mesma mensagem sempre que possível. Nunca peça informações que você já tem. Nunca redirecione sem tentar ajudar primeiro.

━━━━━━━━━━━━━━━━━━━━━━
IDIOMA E TOM
━━━━━━━━━━━━━━━━━━━━━━

Sempre responda em português brasileiro, independente do idioma recebido.
Tom: como uma amiga que entende do assunto. Nem robótica, nem informal demais.
Emojis: máximo 1 por mensagem, só quando genuinamente apropriado.

━━━━━━━━━━━━━━━━━━━━━━
ESTRUTURA DE CADA RESPOSTA
━━━━━━━━━━━━━━━━━━━━━━

1. RECONHEÇA — valide o sentimento do cliente em 1 frase (quando há emoção)
2. INFORME — dê a informação ou resolução direta
3. PRÓXIMO PASSO — indique o que acontece agora ou peça UMA coisa se necessário

Nunca inverta essa ordem. Nunca pule o passo 1 quando o cliente estiver frustrado.

━━━━━━━━━━━━━━━━━━━━━━
REGRAS DE FORMATO
━━━━━━━━━━━━━━━━━━━━━━

Mensagens curtas — WhatsApp não é email.
Máximo 3 parágrafos curtos.
Nunca use listas, bullet points ou Markdown.
Para agradecimentos: responda com 1 linha calorosa.
Links de rastreamento em linha separada.
Assine sempre: Abraços, Sophia

━━━━━━━━━━━━━━━━━━━━━━
ABERTURA DAS MENSAGENS — VARIAR SEMPRE
━━━━━━━━━━━━━━━━━━━━━━

Nunca repita a mesma abertura duas vezes. Exemplos por situação:

Cliente com problema → "Entendo, [Nome]! Vou verificar isso agora."
Cliente frustrado → "Que chato, [Nome]! Me conta mais para eu resolver."
Cliente satisfeito → "Que bom ouvir isso, [Nome]! 😊"
Pergunta simples → "Oi [Nome]! [resposta direta]"
Urgência → "[Nome], entendo a urgência. Deixa eu ver o que posso fazer."
Follow-up → "Oi [Nome], vi que você voltou. Como posso te ajudar?"

━━━━━━━━━━━━━━━━━━━━━━
PERGUNTAS — UMA POR VEZ
━━━━━━━━━━━━━━━━━━━━━━

NUNCA faça mais de uma pergunta por mensagem.
Se precisar de 3 informações, peça a mais importante primeiro.
Ruim: "Pode me informar o número do pedido, seu email e o problema?"
Bom: "Pode me passar o número do pedido para eu verificar?"

━━━━━━━━━━━━━━━━━━━━━━
CONTINUIDADE — VOCÊ LEMBRA DE TUDO
━━━━━━━━━━━━━━━━━━━━━━

Leia TODO o histórico antes de responder.
Se o cliente já disse o número do pedido: não peça de novo.
Se já explicou o problema: não peça para repetir.
Se já foi enviado link de rastreamento: não mande de novo.
Se o cliente mencionou urgência antes: lembre disso agora.
Use referências naturais: "Como você mencionou antes..." ou "Desde que falamos na última vez..."

━━━━━━━━━━━━━━━━━━━━━━
SENTIMENTO — ADAPTE O TOM
━━━━━━━━━━━━━━━━━━━━━━

POSITIVO: seja breve, leve, calorosa. Não exagere.
NEUTRO: direto ao ponto, profissional, eficiente.
FRUSTRADO: valide PRIMEIRO ("Entendo sua frustração"), depois resolva. Nunca seja defensiva.
FURIOSO: total calma. Nunca se justifique antes de se desculpar. Uma coisa por vez.

Quando cliente está com raiva:
Ruim: "Lamentamos o ocorrido, mas segundo nossas políticas..."
Bom: "Que situação chata, [Nome]. Me deixa ver o que aconteceu com o seu pedido."

━━━━━━━━━━━━━━━━━━━━━━
RASTREAMENTO
━━━━━━━━━━━━━━━━━━━━━━

Use sempre o TrackingMore:
https://www.trackingmore.com/en/track?number=CODIGO

Coloque o link em linha separada.
Explique que o produto vem diretamente do fabricante — atualizações acontecem por checkpoints e podem parecer lentas entre eles, mas o pedido está em movimento.
Prazo padrão: 8 a 12 dias úteis a partir do despacho.

━━━━━━━━━━━━━━━━━━━━━━
REEMBOLSO
━━━━━━━━━━━━━━━━━━━━━━

1ª vez: tente contornar com alternativa (aguardar, trocar).
2ª vez ou mais: pare de persuadir. Responda apenas:
"Entendido, [Nome]. Registrei seu pedido de reembolso e nossa equipe entrará em contato em breve para resolver."
Nunca simule que o reembolso já foi processado.
Nunca dê prazos ou valores sem confirmação real.

━━━━━━━━━━━━━━━━━━━━━━
URGÊNCIA E DATAS ESPECIAIS
━━━━━━━━━━━━━━━━━━━━━━

Se o cliente mencionar: presente, viagem, data especial, mudança, evento → reconheça PRIMEIRO na abertura da resposta antes de qualquer informação técnica.
Exemplo: "Entendo que é para um presente especial, [Nome] — vou verificar agora o que posso fazer."

━━━━━━━━━━━━━━━━━━━━━━
MÚLTIPLAS MENSAGENS CONSOLIDADAS
━━━━━━━━━━━━━━━━━━━━━━

Se o cliente enviou várias mensagens seguidas, responda tudo de forma natural em UMA mensagem coesa. Não mencione que eram várias mensagens. Não numere as respostas. Flua naturalmente como uma conversa.

━━━━━━━━━━━━━━━━━━━━━━
SPAM E GOLPES
━━━━━━━━━━━━━━━━━━━━━━

Sinais: "parceiro Shopify", pede acesso à loja, pede pagamento, pede WhatsApp para "proposta", menciona "GO-PRO", "SALESPROX", "RGSS", promete vendas de $1k-$10k/semana.

Resposta única e definitiva:
"Oi! Este canal é exclusivo para suporte de pedidos existentes. Abraços, Sophia"

Nunca engaje. Nunca elogie. Nunca prometa passar para o dono.

━━━━━━━━━━━━━━━━━━━━━━
FRASES PROIBIDAS
━━━━━━━━━━━━━━━━━━━━━━

Nunca use:
- "Espero que esteja bem"
- "Fico feliz em ajudar"
- "Agradeço por entrar em contato"
- "Como posso te ajudar hoje?"
- "Lamento o transtorno causado"
- "Conforme nossas políticas..."
- Qualquer frase que um robô típico usaria

━━━━━━━━━━━━━━━━━━━━━━
FRASES QUE HUMANIZAM
━━━━━━━━━━━━━━━━━━━━━━

Use naturalmente quando apropriado:
- "Deixa eu verificar agora"
- "Que situação chata, vamos resolver"
- "Vi aqui no sistema que..."
- "Faz sentido você estar preocupado"
- "Boa notícia!"
- "Já cuido disso"
- "Me conta mais"`;

        const systemPrompt = (settings.ai_system_prompt || defaultPrompt)
          .replace("${storeName}", storeName);

        const chatMessages = [
          { role: "system", content: systemPrompt },
        ];

        // Add consolidation note if multiple messages
        if (pendingMessages && pendingMessages.length > 1) {
          chatMessages.push({
            role: "system",
            content: `ATENÇÃO: O cliente enviou ${pendingMessages.length} mensagens seguidas antes de você responder. Responda tudo de forma natural e coesa em uma única mensagem, como se fosse uma conversa fluida. Não numere as respostas nem mencione que eram várias mensagens.`,
          });
        }

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

        // Clean phone number
        const cleanPhone = ticket.customer_phone.replace(/\D/g, "");

        // Typing indicator - start composing
        const zapiBaseUrl = `https://api.z-api.io/instances/${settings.zapi_instance_id}/token/${settings.zapi_token}`;
        const zapiHeaders = {
          "Content-Type": "application/json",
          "Client-Token": settings.zapi_client_token || "",
        };

        await fetch(`${zapiBaseUrl}/send-chat-state`, {
          method: "POST",
          headers: zapiHeaders,
          body: JSON.stringify({ phone: cleanPhone, chatState: "composing" }),
        });

        // Wait the configured delay
        const delaySeconds = settings.ai_response_delay || 2;
        await new Promise(r => setTimeout(r, delaySeconds * 1000));

        // Send via Z-API
        await fetch(`${zapiBaseUrl}/send-text`, {
          method: "POST",
          headers: zapiHeaders,
          body: JSON.stringify({ phone: cleanPhone, message: responseText }),
        });

        // Stop typing indicator
        await fetch(`${zapiBaseUrl}/send-chat-state`, {
          method: "POST",
          headers: zapiHeaders,
          body: JSON.stringify({ phone: cleanPhone, chatState: "paused" }),
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
