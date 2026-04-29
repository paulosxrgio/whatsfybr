import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { sendZapiText } from "../_shared/zapi.ts";

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

    console.log(`[SCHEDULER] Processando ${queue?.length || 0} itens da fila`);

    if (!queue || queue.length === 0) {
      return new Response(JSON.stringify({ processed: 0 }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    let processed = 0;

    for (const item of queue) {
      try {
        // ── ANTI-LOOP: pular se outbound enviado há menos de 30s ──
        const { data: lastOutboundCheck } = await supabase
          .from("messages")
          .select("created_at")
          .eq("ticket_id", item.ticket_id)
          .eq("direction", "outbound")
          .order("created_at", { ascending: false })
          .limit(1)
          .maybeSingle();

        if (lastOutboundCheck) {
          const secondsSinceLast = (Date.now() - new Date(lastOutboundCheck.created_at).getTime()) / 1000;
          if (secondsSinceLast < 30) {
            console.log(`[ANTI-LOOP] Pulando ticket ${item.ticket_id}: última outbound há ${secondsSinceLast.toFixed(1)}s`);
            await supabase.from("auto_reply_queue").update({
              scheduled_for: new Date(Date.now() + 30000).toISOString(),
            }).eq("id", item.id);
            continue;
          }
        }

        // Lock atômico: marcar como processing SOMENTE se ainda estiver pending
        const { data: locked, error: lockError } = await supabase
          .from("auto_reply_queue")
          .update({ status: "processing" })
          .eq("id", item.id)
          .eq("status", "pending")
          .select("id");

        if (lockError || !locked || locked.length === 0) {
          console.log(`[SKIP] item ${item.id} já está sendo processado por outro worker`);
          continue;
        }

        const { data: settings } = await supabase.from("settings").select("*").eq("store_id", item.store_id).single();
        if (!settings) { await supabase.from("auto_reply_queue").update({ status: "failed" }).eq("id", item.id); continue; }
        if (!settings.ai_is_active) { await supabase.from("auto_reply_queue").update({ status: "skipped" }).eq("id", item.id); continue; }

        // Fetch account-level AI settings
        const { data: storeData } = await supabase.from("stores").select("user_id").eq("id", item.store_id).single();
        if (!storeData) { await supabase.from("auto_reply_queue").update({ status: "failed" }).eq("id", item.id); continue; }

        const { data: acctSettings } = await supabase.from("account_settings").select("*").eq("user_id", storeData.user_id).maybeSingle();
        const aiProvider = acctSettings?.ai_provider || "openai";
        const aiModel = acctSettings?.ai_model || "gpt-4o-mini";
        const openaiApiKey = acctSettings?.openai_api_key || "";
        const anthropicApiKey = acctSettings?.anthropic_api_key || "";

        const { data: ticket } = await supabase.from("tickets").select("*").eq("id", item.ticket_id).single();
        if (!ticket) { await supabase.from("auto_reply_queue").update({ status: "failed" }).eq("id", item.id); continue; }

        // Skip se IA pausada manualmente neste ticket
        if (ticket.ai_paused) {
          await supabase.from("auto_reply_queue").update({ status: "skipped" }).eq("id", item.id);
          console.log(`[SKIP] ticket ${item.ticket_id} com IA pausada manualmente`);
          continue;
        }

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

        console.log(`[SCHEDULER:CTX] ticket=${item.ticket_id} store=${item.store_id} queue_id=${item.id} scheduled_for=${item.scheduled_for} last_outbound=${lastReplyAt} inbound_pendentes=${pendingMessages?.length || 0}`);
        console.log(`Processando ${pendingMessages?.length || 0} mensagens consolidadas para ticket ${item.ticket_id}`);

        // Early-return: se não há mensagens novas para responder, marcar como done e pular
        if (!pendingMessages || pendingMessages.length === 0) {
          console.log(`[SCHEDULER] Nenhuma mensagem nova para responder no ticket ${item.ticket_id} — marcando como done`);
          await supabase.from("auto_reply_queue").update({ status: "done" }).eq("id", item.id);
          continue;
        }

        // ── DETECTAR PEDIDO DE ATENDENTE HUMANO ──
        const wantsHuman = consolidatedInput.toLowerCase().match(
          /falar com (atendente|humano|pessoa|alguém|alguem|responsável|responsavel|gerente)|atendente (humano|real|de verdade)|me pass(a|e) (para|pro|pra) (atendente|humano|pessoa|alguém|alguem)|quero (falar|conversar) com (alguém|alguem|uma pessoa|humano|atendente)|n[ãa]o (quero|consigo|posso) (falar|conversar) com (rob[ôo]|ia|bot)|chama (um|uma) (atendente|pessoa|humano)|preciso de (atendimento|ajuda) (humana?|real)/i
        );

        if (wantsHuman) {
          console.log(`[HUMAN HANDOFF] Cliente pediu atendente humano no ticket ${item.ticket_id}`);

          // Pausar IA neste ticket
          await supabase.from("tickets")
            .update({ ai_paused: true, ai_paused_at: new Date().toISOString() })
            .eq("id", item.ticket_id);

          const handoffMessage = "Entendido! Vou chamar nossa equipe para te atender. Um momento. 💛";

          try {
            const cleanHandoffPhone = ticket.customer_phone.replace(/\D/g, "");
            const sendResult = await sendZapiText({
              instanceId: settings.zapi_instance_id,
              token: settings.zapi_token,
              clientToken: settings.zapi_client_token,
              phone: cleanHandoffPhone,
              message: handoffMessage,
              origin: "ai_handoff",
            });

            if (!sendResult.ok) {
              console.error(`[HUMAN HANDOFF FAIL] ${sendResult.error}`, sendResult.zapi_response);
              // NÃO inserir em messages — mensagem não foi entregue
            } else {
              const { data: savedHandoff } = await supabase.from("messages").insert({
                ticket_id: item.ticket_id,
                store_id: item.store_id,
                direction: "outbound",
                content: handoffMessage,
                message_type: "text",
                source: "ai",
                zapi_message_id: sendResult.zapi_message_id,
                zapi_zaap_id: sendResult.zapi_zaap_id,
                zapi_id: sendResult.zapi_id,
                zapi_response: sendResult.zapi_response,
                delivery_status: "sent_to_zapi",
                delivery_updated_at: new Date().toISOString(),
              }).select("id").single();
              console.log("[MESSAGE SAVED]", JSON.stringify({ id: savedHandoff?.id, origin: "ai_handoff", zapi_message_id: sendResult.zapi_message_id, zapi_zaap_id: sendResult.zapi_zaap_id, zapi_id: sendResult.zapi_id }));
            }
          } catch (e) {
            console.error("[HUMAN HANDOFF] Erro ao enviar mensagem ao cliente:", e);
          }

          // Notificar Paulo
          try {
            await sendZapiText({
              instanceId: settings.zapi_instance_id,
              token: settings.zapi_token,
              clientToken: settings.zapi_client_token,
              phone: "553388756885",
              message: `⚠️ *Atendimento Humano Solicitado*\n\nCliente: ${ticket.customer_name || "(sem nome)"}\nTelefone: ${ticket.customer_phone}\n\nA IA foi pausada. Acesse o painel para responder manualmente.`,
              origin: "supervisor_alert",
            });
          } catch (e) {
            console.error("[HUMAN HANDOFF] Erro ao notificar operador:", e);
          }

          await supabase.from("auto_reply_queue").update({ status: "done" }).eq("id", item.id);
          processed++;
          continue;
        }

        // Buscar últimas 10 mensagens do ticket para contexto (otimização de custo)
        const { data: messageHistory } = await supabase
          .from("messages")
          .select("content, direction, message_type, created_at")
          .eq("ticket_id", item.ticket_id)
          .order("created_at", { ascending: true })
          .limit(10);

        // Formatar histórico de forma clara para a IA, truncando se muito longo
        const rawFormattedHistory = messageHistory
          ?.map(m => {
            const time = m.created_at ? new Date(m.created_at).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }) : '';
            const author = m.direction === 'outbound' ? 'SOPHIA' : 'CLIENTE';
            const content = m.message_type === 'image'
              ? (m.content && m.content.startsWith('[Imagem') ? m.content : (m.content || '[cliente enviou uma imagem]'))
              : m.message_type === 'audio'
              ? `[áudio transcrito: ${m.content || ''}]`
              : m.content || '';
            return `[${time}] ${author}: ${content}`;
          })
          .join('\n') || '';
        const formattedHistory = rawFormattedHistory.slice(-3000); // máx 3000 chars

        const { data: memory } = await supabase
          .from("customer_memory")
          .select("*")
          .eq("store_id", item.store_id)
          .eq("customer_phone", ticket.customer_phone)
          .maybeSingle();

        // ── Buscar solicitações já registradas para este ticket (anti-loop) ──
        const { data: pendingRequests } = await supabase
          .from("requests")
          .select("type, order_name, details, created_at")
          .eq("ticket_id", item.ticket_id)
          .eq("status", "pending")
          .order("created_at", { ascending: false });

        const requestsContext = (pendingRequests && pendingRequests.length > 0)
          ? `\n══════════════════════════════\nSOLICITAÇÕES JÁ REGISTRADAS PARA ESTE CLIENTE:\n${pendingRequests.map((r: any) => `- ${r.type} no pedido ${r.order_name || '(sem nº)'}: ${JSON.stringify(r.details || {})}`).join('\n')}\n\nINSTRUÇÃO CRÍTICA: Estas solicitações JÁ FORAM REGISTRADAS. NÃO peça as informações novamente. NÃO pergunte cor/tamanho/endereço se já estiverem nos detalhes acima. Apenas confirme que está sendo processado e tranquilize o cliente.\n══════════════════════════════\n`
          : '';

        const storeName = (await supabase.from("stores").select("name").eq("id", item.store_id).single()).data?.name || "Loja";

        const conversationHistory = messageHistory?.slice(-3).map(m => m.content || "").filter(Boolean) || [];
        const intentDetectionPrompt = `Analise a mensagem abaixo e classifique a intenção em UMA palavra:

- "support" = cliente já comprou e tem problema (entrega, reembolso, rastreio, reclamação)
- "sales" = cliente está interessado em comprar, tirando dúvidas sobre produto, preço, disponibilidade
- "unclear" = não dá para determinar ainda

Mensagem: "${consolidatedInput}"
Histórico recente: "${conversationHistory.slice(-2).join(' | ')}"

Responda SOMENTE uma palavra: support, sales ou unclear`;

        let intent = "unclear";
        try {
          let intentRaw = "";
          if (aiProvider === "openai") {
            // Responses API: POST /v1/responses
            const controller = new AbortController();
            const timeout = setTimeout(() => controller.abort(), 20000);
            try {
              const res = await fetch("https://api.openai.com/v1/responses", {
                method: "POST",
                headers: { "Content-Type": "application/json", "Authorization": `Bearer ${openaiApiKey}` },
                body: JSON.stringify({
                  model: aiModel,
                  instructions: "Responda SOMENTE uma palavra: support, sales ou unclear",
                  input: intentDetectionPrompt,
                  store: false,
                  max_output_tokens: 16,
                }),
                signal: controller.signal,
              });
              clearTimeout(timeout);
              const data = await res.json();
              if (!res.ok) {
                console.error(`OpenAI intent error: HTTP ${res.status}`, JSON.stringify(data.error || data));
                throw new Error(`OpenAI API error: ${data.error?.message || res.status}`);
              }
              intentRaw = data.output_text || data.output?.[0]?.content?.[0]?.text || "";
            } catch (e) {
              if (e.name === "AbortError") throw new Error("OpenAI timeout na detecção de intenção");
              throw e;
            }
          } else if (aiProvider === "anthropic") {
            const res = await fetch("https://api.anthropic.com/v1/messages", {
              method: "POST",
              headers: { "Content-Type": "application/json", "x-api-key": anthropicApiKey, "anthropic-version": "2023-06-01" },
              body: JSON.stringify({ model: aiModel, max_tokens: 10, messages: [{ role: "user", content: intentDetectionPrompt }] }),
            });
            const data = await res.json();
            if (!res.ok) {
              console.error(`Anthropic intent error: HTTP ${res.status}`, JSON.stringify(data.error || data));
              throw new Error(`Anthropic API error: ${data.error?.message || res.status}`);
            }
            intentRaw = data.content?.[0]?.text || "";
          }
          const lower = intentRaw.trim().toLowerCase();
          intent = lower.includes("sales") ? "sales" : lower.includes("support") ? "support" : "unclear";
        } catch (e) {
          console.error("Intent detection error:", e);
        }

        console.log(`Intenção detectada: ${intent} para ticket ${item.ticket_id}`);
        await supabase.from("tickets").update({ intent }).eq("id", item.ticket_id);

        // Build dynamic prompt
        const salesModePrompt = `
━━━━━━━━━━━━━━━━━━━━━━
MODO ATIVO: VENDEDORA + COPYWRITER
━━━━━━━━━━━━━━━━━━━━━━

Este cliente está interessado em comprar. Seu objetivo agora é fazer ele QUERER comprar e fechar.

MENTALIDADE:
Você é uma vendedora apaixonada pela marca que genuinamente acredita no produto. Não empurra — encanta. Você entende o problema do cliente e mostra como o produto resolve especificamente aquele problema.

TÉCNICAS QUE VOCÊ DEVE USAR:

1. PROVA SOCIAL — mencione naturalmente que outras pessoas adoram:
"A maioria dos nossos clientes que tinha essa mesma dúvida ficou surpresa com..."
"Estamos recebendo muito feedback positivo justamente sobre isso"

2. ESPECIFICIDADE — nunca seja genérica. Se o cliente perguntou sobre o produto X, responda sobre o produto X com detalhes concretos.

3. ANTECIPE OBJEÇÕES — se o cliente hesitar, aborde o medo antes dele falar:
"Sei que pode parecer caro à primeira vista, mas quando você vê a qualidade..."
"Muita gente fica em dúvida sobre o tamanho, mas temos troca grátis"

4. URGÊNCIA NATURAL — nunca force, mas crie contexto:
"Esse modelo em específico tem saído bastante esta semana"
"Temos estoque limitado dessa versão"

5. PRÓXIMO PASSO CLARO — sempre feche com uma pergunta ou ação:
"Posso te enviar o link direto para finalizar?"
"Qual seria o melhor endereço para entrega?"
"Prefere pagar no cartão ou PIX?"

FORMATO:
Mensagens curtas e entusiasmadas, mas sem parecer desespero.
Máximo 3 parágrafos.
Um emoji por mensagem quando for natural.
Nunca use bullet points.

NUNCA:
- Prometa o que não pode cumprir
- Invente informações sobre o produto
- Force a venda de forma óbvia
- Seja genérica ("ótima escolha!", "com certeza!")

FECHAMENTO — QUANDO O CLIENTE JÁ DEU TODAS AS INFORMAÇÕES:

Se o cliente já disse produto + cor + tamanho e só tem uma dúvida restante, resolva a dúvida E já direcione para a compra na mesma mensagem:

Exemplo correto:
"Mary, trabalhamos com envio expresso Sedex! Para o Vestido Daphne preto M chegar antes de 23/04, você precisaria finalizar o pedido hoje. Posso te enviar o link direto para garantir? 😊"

Não espere a próxima mensagem para fechar. Se você tem todas as informações, aja agora.`;

        const supportModePrompt = `
━━━━━━━━━━━━━━━━━━━━━━
MODO ATIVO: SUPORTE
━━━━━━━━━━━━━━━━━━━━━━

Este cliente já comprou e precisa de ajuda. Seu objetivo é resolver o problema e deixar o cliente satisfeito.

PRIORIDADE: resolver. Não vender.

Siga as regras de suporte do sistema. Reconheça, informe, próximo passo.
Tom: calmo, empático, eficiente.`;

        const unclearModePrompt = `
━━━━━━━━━━━━━━━━━━━━━━
MODO ATIVO: IDENTIFICAÇÃO
━━━━━━━━━━━━━━━━━━━━━━

Ainda não está claro se este cliente quer suporte ou está interessado em comprar.
Responda de forma amigável e tente entender a necessidade dele com UMA pergunta natural.
Não force nenhum dos dois modos ainda.`;

        const modePrompt = intent === "sales" ? salesModePrompt
          : intent === "support" ? supportModePrompt
          : unclearModePrompt;

        const baseSystemPrompt = `Você é Sophia, atendente da loja ${storeName} via WhatsApp.

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

Use SEMPRE este formato (link da própria loja, NUNCA trackingmore):
https://adorisse.com.br/apps/parcelpanel?nums=CODIGO

Coloque o link em linha separada.
Explique que o produto vem diretamente do fabricante — atualizações acontecem por checkpoints e podem parecer lentas entre eles, mas o pedido está em movimento.
Prazo padrão: 8 a 12 dias úteis a partir do despacho.

━━━━━━━━━━━━━━━━━━━━━━
REEMBOLSO E CANCELAMENTO
━━━━━━━━━━━━━━━━━━━━━━

PRIMEIRA MENÇÃO de reembolso/cancelamento/devolução:
Seja extremamente empática, acolhedora e tranquilizadora.
Tente entender o motivo real e ofereça uma solução alternativa antes de aceitar o reembolso.

Exemplos de contorno:
- Pedido atrasado → mostre o rastreamento, reafirme o prazo
- Produto errado → ofereça troca
- Arrependimento → destaque os benefícios do produto
- Prazo → explique que está a caminho

Tom obrigatório na 1ª menção:
"Fico muito triste em saber que você está pensando em cancelar 😢 Antes de tudo, me conta o que aconteceu? Quero muito resolver isso pra você da melhor forma possível!"

SEGUNDA MENÇÃO ou insistência no reembolso:
Aceite sem resistência, com simpatia total. NÃO tente mais convencer.
Direcione para o formulário com carinho:

"Tudo bem, entendo completamente e respeito sua decisão 💛 Para que possamos processar seu reembolso o mais rápido possível, peço gentilmente que preencha nosso formulário pelo link abaixo — nossa equipe vai cuidar de tudo com prioridade:

👉 https://reembolso.adorisse.com/

Assim que receber, trataremos com toda atenção que você merece. Se precisar de qualquer outra coisa, estarei aqui! 🌸"

REGRAS ABSOLUTAS sobre reembolso:
- NUNCA seja fria, burocrática ou dificulte o processo
- NUNCA diga "não podemos" ou "não é possível"
- NUNCA ignore o sentimento da cliente antes de responder
- SEMPRE use tom acolhedor, como se fosse uma amiga ajudando
- SEMPRE encaminhe para https://reembolso.adorisse.com/ na 2ª menção
- Após enviar o link, deseje um bom dia/tarde/noite com carinho

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
- "Me conta mais"

━━━━━━━━━━━━━━━━━━━━━━
REGRA ANTI-REPETIÇÃO — CRÍTICA
━━━━━━━━━━━━━━━━━━━━━━

Antes de fazer qualquer pergunta, verifique o histórico da conversa E a seção "SOLICITAÇÕES JÁ REGISTRADAS".

Se já existe uma SOLICITAÇÃO REGISTRADA para este cliente:
- NÃO peça a informação novamente
- NÃO pergunte "qual cor você gostaria?" se a cor já foi informada
- NÃO pergunte tamanho/endereço/produto se já estão nos detalhes registrados
- Responda: "Sua solicitação de [tipo] já está registrada e sendo processada. Nossa equipe resolverá em até 24h. 💛"

Se o cliente responder "ok", "obrigada", "tudo bem", "valeu" após uma confirmação:
- Responda brevemente e encerre: "Fico por aqui! Qualquer dúvida, é só chamar. 😊"
- NÃO repita o status do pedido, NÃO pergunte mais nada

Se o cliente der uma informação (cor, tamanho, endereço) pela SEGUNDA vez:
- Significa que você perguntou de novo sem necessidade
- Responda: "Perfeito, já anotei! Sua solicitação está registrada. 💛"
- Não peça mais nada

NUNCA peça uma informação que já apareceu no histórico acima.
NUNCA ignore uma informação que o cliente forneceu.
Se o cliente disse o produto, cor e tamanho — você já sabe. Use essa informação.

━━━━━━━━━━━━━━━━━━━━━━
IMAGENS E MÍDIAS
━━━━━━━━━━━━━━━━━━━━━━

- Quando ver [Imagem: descrição] no histórico, use essa descrição para responder — você JÁ viu a imagem.
- Comprovante de pagamento → confirme recebimento e verifique no pedido
- Print de anúncio/produto → identifique se é da Adorisse pelo domínio adorisse.com.br
- Foto de produto recebido com problema → registre como solicitação de troca
- NUNCA diga que não consegue ver imagens — agora você consegue.
- Se a descrição vier como [Imagem recebida — não foi possível analisar], peça gentilmente: "Recebi sua imagem, mas tive um problema ao processá-la. Pode me descrever rapidinho?"

━━━━━━━━━━━━━━━━━━━━━━
REGRAS DE FECHAMENTO — OBRIGATÓRIAS
━━━━━━━━━━━━━━━━━━━━━━

SE o cliente disse "sim", "pode ser", "quero", "ok", "manda" em resposta a uma oferta ou pergunta sua:
→ Aja imediatamente. Não repita a pergunta. Execute o que foi pedido.

SE você prometeu enviar um link e o cliente confirmou:
→ Na próxima mensagem, envie o link. Nunca pergunte de novo.

SE você já sabe produto + cor + tamanho:
→ Nunca mais pergunte sobre produto, cor ou tamanho.
→ Use essa informação diretamente: "Perfeito! O Vestido Daphne preto M..."

SE o cliente repetiu a mesma informação mais de uma vez:
→ Reconheça explicitamente: "Desculpe, já vi que você me informou o Daphne preto M. Vou resolver isso agora."
→ Nunca faça o cliente repetir uma terceira vez.

FLUXO CORRETO quando cliente quer comprar com prazo:
1ª mensagem — confirme o produto que ele quer
2ª mensagem — responda a dúvida do prazo/frete com SIM ou NÃO
3ª mensagem — envie o link ou próxima ação concreta

Nunca fique em loop de "vou verificar". Se não sabe a resposta, diga que não sabe e ofereça alternativa.

━━━━━━━━━━━━━━━━━━━━━━
AÇÕES QUE VOCÊ NUNCA PODE FAZER (ANTI-ALUCINAÇÃO)
━━━━━━━━━━━━━━━━━━━━━━

- NUNCA diga "não sou robô" ou "sou atendente humana" — você é a Sophia, assistente virtual da ${storeName}.
- NUNCA prometa "vou ajustar manualmente seu pedido" — você não tem acesso para alterar pedidos.
- NUNCA prometa "vou te enviar fotos do produto" — você não pode enviar imagens.
- NUNCA fique em loop dizendo "vou verificar" sem dar uma resposta concreta na mensagem seguinte.
- NUNCA diga que um pedido é de outra loja sem ter certeza absoluta — primeiro pergunte o email.
- Se NÃO encontrou o pedido pelo telefone, SEMPRE pergunte o email antes de concluir que é de outra loja.

━━━━━━━━━━━━━━━━━━━━━━
O QUE VOCÊ NÃO SABE — NUNCA INVENTE
━━━━━━━━━━━━━━━━━━━━━━

- NUNCA afirme que a ${storeName} é fabricante — você não sabe onde os produtos são fabricados
- NUNCA diga onde fica a "fábrica" — essa informação não existe no seu contexto
- NUNCA prometa enviar catálogo — você não tem catálogo para enviar
- NUNCA prometa cancelar um pedido — registre a solicitação, equipe executa
- NUNCA prometa fazer alteração no pedido — registre, equipe executa

INFORMAÇÕES QUE NÃO TENHO — NUNCA INVENTE:
- A ${storeName} NÃO vende no atacado — se perguntado: "No momento trabalhamos apenas com vendas no varejo pelo site adorisse.com.br"
- NÃO tenho o link direto de produtos específicos — direcione para adorisse.com.br e diga para buscar pelo nome do produto
- NÃO conheço promoções ou descontos que não estejam no contexto desta conversa
- NÃO sei a medida exata de ombro, busto ou outros detalhes técnicos que não estão nos dados do produto
- NÃO existe valor mínimo de compra, política de atacado, ou condições especiais que não estejam explícitas aqui

Quando não souber a resposta:
"Não tenho essa informação disponível aqui, mas nossa equipe pode te ajudar! Você pode nos contatar pelo site."

━━━━━━━━━━━━━━━━━━━━━━
SOBRE CNPJ E DADOS LEGAIS — REGRA ABSOLUTA
━━━━━━━━━━━━━━━━━━━━━━

VOCÊ NÃO TEM O CNPJ DA EMPRESA. NUNCA forneça nenhum número de CNPJ.
NUNCA invente, suponha, gere ou complete um CNPJ — mesmo que pareça plausível.
Números como 12.345.678/0001-90, 53.123.456/0001-00 ou qualquer outro são FALSOS.
Inventar CNPJ é ilegal e gera passivo jurídico para a empresa.

Resposta ÚNICA quando pedirem CNPJ ou dados legais:
"Para informações legais sobre a empresa, acesse adorisse.com.br ou envie um e-mail para contato@adorisse.com.br."

Se o cliente insistir, repita exatamente a mesma frase. NUNCA forneça um número.

━━━━━━━━━━━━━━━━━━━━━━
INFORMAÇÕES QUE NÃO TENHO — NUNCA INVENTE
━━━━━━━━━━━━━━━━━━━━━━

Você NÃO sabe e NÃO pode inventar:
- ENDEREÇO FÍSICO: A Adorisse NÃO tem loja física em lugar nenhum (nem em Feira de Santana, nem em qualquer outra cidade). NUNCA invente endereço, rua, bairro ou cidade. Resposta: "Atendemos exclusivamente online pelo site adorisse.com.br."
- ORIGEM DOS PRODUTOS: NÃO afirme que produtos vêm "do Brasil", "da China" ou de qualquer país. Resposta: "Os produtos vêm diretamente do nosso fabricante."
- PARCELAMENTO SEM JUROS: NÃO afirme que parcelamos sem juros nem confirme número de parcelas. Resposta: "As condições de parcelamento aparecem no checkout do site adorisse.com.br."
- CNPJ: ver regra acima.
- DETALHES TÉCNICOS DO PRODUTO: medidas exatas de ombro, busto, tecido, composição que não estejam no contexto. Resposta: "Não tenho esse detalhe aqui — recomendo conferir na descrição do produto no site."
- PROMOÇÕES, CUPONS, DESCONTOS que não estejam no contexto.
- ATACADO: trabalhamos apenas com varejo pelo site.

Regra geral: se você NÃO viu a informação no contexto desta conversa ou nos dados do pedido, NÃO INVENTE. Direcione ao site ou ao e-mail contato@adorisse.com.br.

━━━━━━━━━━━━━━━━━━━━━━
PRAZO DE ENTREGA — REGRA ABSOLUTA
━━━━━━━━━━━━━━━━━━━━━━

O prazo CORRETO é 8 a 12 dias úteis a partir do despacho.
Se o site mostrar "2 a 5 dias", isso é um erro desatualizado.
Nunca confirme 2 a 5 dias — sempre corrija para 8 a 12 dias úteis.
Resposta padrão: "O prazo de entrega é de 8 a 12 dias úteis após o despacho."

━━━━━━━━━━━━━━━━━━━━━━
AXION DIGITAL — EMPRESA OPERACIONAL DA ADORISSE
━━━━━━━━━━━━━━━━━━━━━━

A "Axion Digital" (Axion Digital Ltda) é a NOSSA empresa operacional/logística.
Alguns clientes recebem e-mails, comprovantes de pagamento ou cobrança no nome da Axion Digital — isso é NORMAL e o pedido É da Adorisse.

Se o cliente mostrar comprovante da Axion Digital:
- TRATE COMO PEDIDO DA ADORISSE
- Busque normalmente pelo telefone/email do cliente
- NUNCA diga "você comprou em outra loja"
- Se perguntarem: "Axion Digital é a empresa que opera a logística e o pagamento da Adorisse — pode ficar tranquilo(a), seu pedido está conosco. 💛"

━━━━━━━━━━━━━━━━━━━━━━
OUTRAS EMPRESAS (NÃO RELACIONADAS)
━━━━━━━━━━━━━━━━━━━━━━

Não conhecemos nem representamos: Serenna, Serena, Nala Modas, Velora,
Pix do Milhão, Agate Ltda, Modacoral, Luna Diva, Fitluck, Itaú Renegociação
ou qualquer outra loja/empresa fora Adorisse e Axion Digital.

Se o pagamento foi feito para uma dessas (e NÃO Axion Digital):
"Essa compra não foi feita na ${storeName}. Entre em contato com a loja onde comprou."

NUNCA diga que outra empresa "é nossa parceira" — você não tem essa informação.

━━━━━━━━━━━━━━━━━━━━━━
QUANDO NÃO ENCONTRAR O PEDIDO
━━━━━━━━━━━━━━━━━━━━━━

Se houver "INSTRUÇÃO ESPECIAL" no contexto pedindo o email do cliente, peça assim:
"Para localizar seu pedido, pode me informar o email que você usou na compra?"

NUNCA diga "sua compra foi feita em outra loja" na primeira tentativa.
Só conclua que é de outra loja quando o sistema confirmar (via "ATENÇÃO: ...não foi localizado nem por telefone nem pelo email salvo") que nem telefone nem email retornaram o pedido.

━━━━━━━━━━━━━━━━━━━━━━
SOLICITAÇÕES DE TROCA, ENDEREÇO E TAMANHO
━━━━━━━━━━━━━━━━━━━━━━

Quando o cliente pedir para TROCAR COR, TAMANHO ou ALTERAR ENDEREÇO antes do envio:
1. Confirme que é possível pois o pedido ainda não foi enviado
2. Peça os detalhes da alteração (qual cor/tamanho/endereço novo)
3. Diga: "Anotei sua solicitação! Vou encaminhar para nossa equipe fazer a alteração — normalmente resolvemos em até 24 horas. Assim que confirmarmos, te aviso por aqui. 💛"
4. NÃO diga "já fiz a alteração" ou "já processei" — você registra a solicitação mas a alteração é feita pela equipe

━━━━━━━━━━━━━━━━━━━━━━
SOLICITAÇÃO DE TROCA DE COR/TAMANHO — PEDIDO ENVIADO
━━━━━━━━━━━━━━━━━━━━━━

Se o pedido já foi enviado E o cliente quer trocar cor ou tamanho:
- Registre a solicitação normalmente na tabela requests
- Diga: "Anotei sua solicitação! Vou encaminhar para nossa equipe verificar a possibilidade de alteração antes do despacho final. Assim que tivermos uma confirmação, te aviso por aqui. 💛"
- NUNCA diga "impossível" ou "já foi enviado, não dá"
- NUNCA garanta que vai chegar na cor nova — use "vou verificar a possibilidade"
- Se o cliente perguntar se vai chegar na cor certa, diga: "Estamos verificando com nossa equipe! Assim que confirmar, te aviso. 💛"

A equipe decide se consegue ou não — Sophia apenas registra e tranquiliza.

━━━━━━━━━━━━━━━━━━━━━━
CLIENTE QUE COMPROU EM OUTRA LOJA
━━━━━━━━━━━━━━━━━━━━━━

Se após 2 tentativas não encontrar o pedido E o cliente mostrar comprovante
de outra loja (Axion Digital, Pix do Milhão, Agate Ltda, etc.) ou domínio
diferente de adorisse.com.br:

Responda UMA ÚNICA VEZ:
"[nome do cliente], identificamos que sua compra foi realizada em outra loja —
não temos registros dela na ${storeName}. Para rastreamento e suporte,
entre em contato diretamente com a loja onde comprou.
Se futuramente comprar aqui, estaremos à disposição! 💛"

Depois dessa resposta: NÃO responda mais sobre o mesmo assunto.
Se cliente insistir com o mesmo tema, responda apenas:
"Como mencionei, esse pedido não está em nosso sistema.
Para mais ajuda, entre em contato com a loja onde comprou. 💛"

NUNCA fique em loop repetindo a mesma explicação múltiplas vezes.

━━━━━━━━━━━━━━━━━━━━━━
PERGUNTAS SEM PEDIDO
━━━━━━━━━━━━━━━━━━━━━━

Se o cliente NÃO comprou ainda e quer saber prazo, produto, tamanho, etc:
- NUNCA peça email — ele não tem pedido ainda
- Responda diretamente: prazo = 8 a 12 dias úteis
- Seja consultiva e ajude a fechar a venda

━━━━━━━━━━━━━━━━━━━━━━
SOBRE SER IA OU HUMANA
━━━━━━━━━━━━━━━━━━━━━━

Se o cliente perguntar "você é IA ou humana?":
Responda com honestidade e leveza:
"Sou a Sophia, assistente virtual da ${storeName} 🤖 Mas pode falar comigo como se fosse uma pessoa — estou aqui para resolver tudo mesmo!"
NUNCA diga "sou uma atendente real" ou "não sou IA"

━━━━━━━━━━━━━━━━━━━━━━
REGRA CRÍTICA — NÃO PEDIR EMAIL
━━━━━━━━━━━━━━━━━━━━━━

NÃO pedir email quando o cliente:
- Perguntar sobre produto, tamanho, cor, preço → responder direto
- Perguntar se a loja é confiável/segura → responder direto, validando a loja
- Perguntar sobre prazo → 8 a 12 dias úteis, responder direto
- Disser "ainda não comprei", "quero comprar", "estou pensando" → modo vendas, SEM pedir email
- Perguntar sobre política de troca/devolução em geral → responder direto
- Enviar foto de produto perguntando se tem → responder sobre o produto, NÃO pedir email

SÓ pedir email quando: cliente menciona um pedido específico que ele JÁ FEZ E o pedido não foi encontrado por telefone.

TESTE MENTAL antes de pedir email:
"Esse cliente TEM um pedido existente que preciso localizar AGORA?"
Se a resposta for NÃO → não peço email, respondo a pergunta diretamente.

Exemplos:
- "Vocês são confiáveis?" → NÃO pedir email, responder validando a loja
- "Quanto tempo demora?" → NÃO pedir email, responder 8-12 dias úteis
- "Tem esse vestido no M?" → NÃO pedir email, responder sobre o produto
- "Meu pedido #1234 não chegou" → SIM, pode pedir email se não localizar pelo telefone`;

        // ── Buscar exemplos de treinamento (respostas humanas ideais) ──
        const { data: trainingExamples } = await supabase
          .from("training_examples")
          .select("customer_input, ideal_response")
          .eq("store_id", item.store_id)
          .order("created_at", { ascending: false })
          .limit(10);

        let trainingBlock = "";
        if (trainingExamples && trainingExamples.length > 0) {
          const formatted = trainingExamples
            .map((e: any, i: number) => `Exemplo ${i + 1}:\nCliente disse: "${(e.customer_input || "").slice(0, 300)}"\nResposta ideal: "${(e.ideal_response || "").slice(0, 400)}"`)
            .join("\n\n");
          const truncated = formatted.slice(0, 2000);
          trainingBlock = `\n\n━━━━━━━━━━━━━━━━━━━━━━\nEXEMPLOS DE RESPOSTAS IDEAIS (aprenda com estes — foram escritos por um operador humano)\n━━━━━━━━━━━━━━━━━━━━━━\n${truncated}\n\nAo responder, IMITE o tom, a estrutura e o estilo desses exemplos. Eles refletem como a loja gostaria que você respondesse.`;
        }

        const systemPrompt = `${baseSystemPrompt}\n\n${modePrompt}${settings.ai_system_prompt ? `\n\n━━━━━━━━━━━━━━━━━━━━━━\nREGRAS ESPECÍFICAS DESTA LOJA\n━━━━━━━━━━━━━━━━━━━━━━\n\n${settings.ai_system_prompt}` : ""}${trainingBlock}`;

        // ── Extração de fatos via IA para evitar loops ──
        let facts: Record<string, string | null> = {};
        if (formattedHistory.length > 0) {
          const factExtractionPrompt = `Leia essa conversa e extraia os fatos que o cliente já forneceu.
Retorne SOMENTE um JSON com os campos encontrados (use null se não mencionado):

{
  "produto": null,
  "cor": null,
  "tamanho": null,
  "cep": null,
  "prazo_desejado": null,
  "numero_pedido": null,
  "acao_solicitada": null
}

Conversa:
${formattedHistory}`;

          try {
            let factsRaw = "";
            if (aiProvider === "openai") {
              const fRes = await fetch("https://api.openai.com/v1/responses", {
                method: "POST",
                headers: { "Content-Type": "application/json", "Authorization": `Bearer ${openaiApiKey}` },
                body: JSON.stringify({ model: aiModel, instructions: "Retorne SOMENTE JSON válido, sem markdown.", input: factExtractionPrompt, store: false, max_output_tokens: 100 }),
              });
              const fData = await fRes.json();
              factsRaw = fData.output_text || fData.output?.[0]?.content?.[0]?.text || "";
            } else if (aiProvider === "anthropic") {
              const fRes = await fetch("https://api.anthropic.com/v1/messages", {
                method: "POST",
                headers: { "Content-Type": "application/json", "x-api-key": anthropicApiKey, "anthropic-version": "2023-06-01" },
                body: JSON.stringify({ model: aiModel, max_tokens: 100, messages: [{ role: "user", content: factExtractionPrompt }] }),
              });
              const fData = await fRes.json();
              factsRaw = fData.content?.[0]?.text || "";
            }
            const clean = factsRaw.replace(/```json|```/g, '').trim();
            facts = JSON.parse(clean);
          } catch (e) {
            console.error("Fact extraction error (non-fatal):", e);
            facts = {};
          }
        }

        const factsContext = Object.entries(facts)
          .filter(([, v]) => v !== null)
          .map(([k, v]) => `${k}: ${v}`)
          .join('\n');

        console.log(`Fatos extraídos para ticket ${item.ticket_id}: ${factsContext || 'nenhum'}`);

        // ── Buscar pedidos Shopify (busca inteligente: telefone → email → número de pedido) ──
        let orderContext = "Nenhum pedido Shopify encontrado para este cliente.";
        let orders: any[] = [];
        let savedEmail: string | null = (memory as any)?.customer_email || null;

        // Extrair possível número de pedido / código de rastreio das últimas mensagens
        const lastMsgsText = (messageHistory || []).slice(-5).map((m: any) => m.content || "").join(" ");
        const orderNumMatch = lastMsgsText.match(/#?(\d{3,6})/);

        // Fallback: se não tem email salvo, tentar extrair do histórico recente e salvar
        if (!savedEmail) {
          const emailInHistory = lastMsgsText.match(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/i)?.[0]?.toLowerCase();
          if (emailInHistory) {
            savedEmail = emailInHistory;
            await supabase.from("customer_memory").upsert({
              store_id: item.store_id,
              customer_phone: ticket.customer_phone,
              customer_email: emailInHistory,
              updated_at: new Date().toISOString(),
            }, { onConflict: "store_id,customer_phone" });
            console.log(`[EMAIL RECOVERED FROM HISTORY] ${ticket.customer_phone} → ${emailInHistory}`);
          }
        }

        try {
          const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
          const supabaseAnonKey = Deno.env.get("SUPABASE_ANON_KEY") || Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

          // 1) Busca por telefone (já existente)
          const ordersRes = await fetch(`${supabaseUrl}/functions/v1/fetch-shopify-orders`, {
            method: "POST",
            headers: { "Content-Type": "application/json", "Authorization": `Bearer ${supabaseAnonKey}` },
            body: JSON.stringify({ store_id: item.store_id, customer_phone: ticket.customer_phone, customer_name: ticket.customer_name }),
          });
          if (ordersRes.ok) {
            const ordersData = await ordersRes.json();
            orders = ordersData?.orders || [];
          }

          // 2) Se não achou por telefone, tenta busca direta no Shopify por email/número de pedido
          if (orders.length === 0 && (savedEmail || orderNumMatch)) {
            let shopifyUrl = settings.shopify_store_url?.replace(/\/$/, "") || "";
            if (shopifyUrl && !/^https?:\/\//i.test(shopifyUrl)) {
              shopifyUrl = `https://${shopifyUrl}`;
            }
            const shopifyToken = settings.shopify_client_secret;
            if (shopifyUrl && shopifyToken) {
              const shopifyHeaders = { "X-Shopify-Access-Token": shopifyToken, "Content-Type": "application/json" };

              const mapShopifyOrder = (o: any) => ({
                name: o.name, order_number: o.order_number, financial_status: o.financial_status,
                status: o.fulfillment_status || "unfulfilled", currency: o.currency, total_price: o.total_price,
                created_at: o.created_at,
                items: (o.line_items || []).map((li: any) => ({ title: li.title, variant_title: li.variant_title, quantity: li.quantity })),
                tracking_number: o.fulfillments?.[0]?.tracking_number || null,
              });

              if (savedEmail) {
                try {
                  console.log(`[EMAIL SEARCH] Buscando pedidos via email: ${savedEmail}`);
                  const emailRes = await fetch(`${shopifyUrl}/admin/api/2024-01/orders.json?email=${encodeURIComponent(savedEmail)}&status=any&limit=5`, { headers: shopifyHeaders });
                  if (emailRes.ok) {
                    const emailData = await emailRes.json();
                    if (emailData.orders?.length > 0) {
                      orders = emailData.orders.map(mapShopifyOrder);
                      console.log(`[EMAIL SEARCH] ${orders.length} pedido(s) encontrado(s) via email ${savedEmail}`);
                    } else {
                      console.log(`[EMAIL SEARCH] Nenhum pedido encontrado via email ${savedEmail}`);
                    }
                  } else {
                    console.error(`[EMAIL SEARCH] HTTP ${emailRes.status} ao buscar por email`);
                  }
                } catch (e) { console.error("[EMAIL SEARCH ERROR]", e); }
              }

              if (orders.length === 0 && orderNumMatch) {
                try {
                  const numRes = await fetch(`${shopifyUrl}/admin/api/2024-01/orders.json?name=%23${orderNumMatch[1]}&status=any`, { headers: shopifyHeaders });
                  if (numRes.ok) {
                    const numData = await numRes.json();
                    if (numData.orders?.length > 0) {
                      orders = numData.orders.map(mapShopifyOrder);
                      console.log(`Pedido via número #${orderNumMatch[1]}: ${orders.length}`);
                    }
                  }
                } catch (e) { console.error("Erro busca por número:", e); }
              }
            }
          }

          if (orders.length > 0) {
            orderContext = `PEDIDOS SHOPIFY DO CLIENTE:\n${orders.map((o: any) =>
              `Pedido ${o.name || o.order_number} — ${o.financial_status === 'paid' ? 'PAGO' : o.financial_status}\n` +
              `Status entrega: ${o.status === 'fulfilled' ? 'Enviado' : o.status === 'partial' ? 'Parcialmente enviado' : 'Aguardando envio'}\n` +
              `Itens: ${(o.items || []).map((i: any) => `${i.title}${i.variant_title ? ' (' + i.variant_title + ')' : ''} x${i.quantity}`).join(', ')}\n` +
              `Total: ${o.currency} ${o.total_price}\n` +
              `${o.tracking_number ? `Código de rastreio: ${o.tracking_number}` : 'Sem código de rastreio ainda'}\n` +
              `${o.tracking_number ? `Link de rastreamento: https://adorisse.com.br/apps/parcelpanel?nums=${o.tracking_number}` : ''}\n` +
              `Data: ${new Date(o.created_at).toLocaleDateString('pt-BR')}`
            ).join('\n---\n')}\n\nUSE ESSES DADOS para responder perguntas sobre pedidos. Mencione o número do pedido e status diretamente.`;
          }
        } catch (e) {
          console.error("Erro ao buscar pedidos Shopify:", e);
        }

        // Detectar pedido mencionado mas não encontrado
        const mentionedOrderNumber = consolidatedInput.match(/#?\d{4,}/)?.[0];
        const foundInShopify = orders.length > 0;

        // Se não achou nada E não tem email salvo → pedir email antes de concluir que é outra loja
        const emailContext = !savedEmail && !foundInShopify
          ? `\n\nINSTRUÇÃO ESPECIAL: Não encontrei pedidos pelo telefone deste cliente E ainda não temos o email dele salvo. Pergunte de forma natural e gentil o email usado na compra para localizar o pedido. Exemplo: "Para localizar seu pedido, pode me informar o email que você usou na compra?". NÃO diga ainda que o pedido é de outra loja.`
          : '';

        const wrongStoreContext = mentionedOrderNumber && !foundInShopify && savedEmail
          ? `ATENÇÃO: O cliente mencionou o pedido ${mentionedOrderNumber} mas não foi localizado nem por telefone nem pelo email salvo (${savedEmail}). Provavelmente é de outra loja. Informe com gentileza e oriente a contatar a loja correta. NÃO invente informações.`
          : '';

        // Construir contexto
        const memoryContext = memory
          ? `DADOS DO CLIENTE: Nome: ${memory.customer_name || "desconhecido"}, Idioma: ${memory.preferred_language}, Último sentimento: ${memory.last_sentiment || "neutro"}, Total interações: ${memory.total_interactions}${memory.notes ? `, Notas: ${memory.notes}` : ""}`
          : "";

        const sentimentInstruction = ticket.sentiment === "frustrated"
          ? "O cliente está FRUSTRADO. Valide o sentimento PRIMEIRO."
          : ticket.sentiment === "angry"
          ? "O cliente está FURIOSO. Máxima calma. Desculpe-se antes de resolver."
          : "";

        // Montar userMessage com fatos extraídos em posição de destaque
        const userMessage = `
══════════════════════════════
FATOS JÁ FORNECIDOS PELO CLIENTE NESTA CONVERSA:
${factsContext || 'nenhum fato identificado ainda'}

REGRA ABSOLUTA: Se um fato já está listado acima, NUNCA pergunte sobre ele novamente.
══════════════════════════════

HISTÓRICO COMPLETO DA CONVERSA:
${formattedHistory}

══════════════════════════════
NOVAS MENSAGENS DO CLIENTE AGUARDANDO RESPOSTA:
${consolidatedInput}
══════════════════════════════
${requestsContext}
${orderContext}
${emailContext}

${wrongStoreContext ? `══════════════════════════════\n${wrongStoreContext}\n══════════════════════════════` : ''}

${memoryContext}
${sentimentInstruction}
`.trim();

        const chatMessages = [
          { role: "system", content: systemPrompt },
        ];

        // Add consolidation note if multiple messages
        if (pendingMessages && pendingMessages.length > 1) {
          chatMessages.push({
            role: "system",
            content: `ATENÇÃO: O cliente enviou ${pendingMessages.length} mensagens seguidas. Responda tudo de forma natural e coesa em uma única mensagem.`,
          });
        }

        // Adicionar histórico como mensagens alternadas para manter contexto na API
        if (messageHistory) {
          for (const msg of messageHistory.slice(0, -1)) {
            chatMessages.push({
              role: msg.direction === "inbound" ? "user" : "assistant",
              content: msg.message_type === "image"
                ? (msg.content && msg.content.startsWith("[Imagem") ? msg.content : (msg.content || "[cliente enviou uma imagem]"))
                : msg.message_type === "audio" ? `[áudio transcrito: ${msg.content || ""}]`
                : msg.content || "[mídia]",
            });
          }
        }

        // A última mensagem do usuário inclui o contexto completo + fatos + mensagens pendentes
        chatMessages.push({ role: "user", content: userMessage });

        // Call AI
        let responseText = "";

        if (aiProvider === "openai") {
          // Responses API: POST /v1/responses
          // Separar system messages como instructions, user/assistant como input
          const instructions = chatMessages
            .filter(m => m.role === "system")
            .map(m => m.content)
            .join("\n\n");
          const inputMessages = chatMessages
            .filter(m => m.role !== "system")
            .map(m => ({ role: m.role, content: m.content }));

          const controller = new AbortController();
          const timeout = setTimeout(() => controller.abort(), 30000);
          try {
            const res = await fetch("https://api.openai.com/v1/responses", {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
                "Authorization": `Bearer ${openaiApiKey}`,
              },
              body: JSON.stringify({
                model: aiModel,
                instructions,
                input: inputMessages,
                store: false,
                max_output_tokens: 400,
              }),
              signal: controller.signal,
            });
            clearTimeout(timeout);
            const data = await res.json();
            if (!res.ok) {
              console.error(`OpenAI response error: HTTP ${res.status}`, JSON.stringify(data.error || data));
              throw new Error(`OpenAI API error: ${data.error?.message || res.status}`);
            }
            responseText = data.output_text || data.output?.[0]?.content?.[0]?.text || "";
          } catch (e) {
            if (e.name === "AbortError") throw new Error("OpenAI timeout na geração de resposta (30s)");
            throw e;
          }
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
              max_tokens: 400,
              system: systemMsg,
              messages: userMsgs,
            }),
          });
          const data = await res.json();
          if (!res.ok) {
            console.error(`Anthropic response error: HTTP ${res.status}`, JSON.stringify(data.error || data));
            throw new Error(`Anthropic API error: ${data.error?.message || res.status}`);
          }
          responseText = data.content?.[0]?.text || "";
        }

        if (!responseText) {
          await supabase.from("auto_reply_queue").update({ status: "failed" }).eq("id", item.id);
          continue;
        }

        // Detect sentiment
        let sentiment = "neutral";
        const lowerContent = (messageHistory?.slice(-1)[0]?.content || "").toLowerCase();
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

        const sendResult = await sendZapiText({
          instanceId: settings.zapi_instance_id,
          token: settings.zapi_token,
          clientToken: settings.zapi_client_token,
          phone: cleanPhone,
          message: responseText,
          origin: "ai_scheduler",
        });

        if (!sendResult.ok) {
          console.error(`[Z-API FAIL] ${sendResult.status || "no-status"}:`, sendResult.zapi_response || sendResult.error);
          // Stop typing
          await fetch(`${zapiBaseUrl}/send-chat-state`, {
            method: "POST", headers: zapiHeaders,
            body: JSON.stringify({ phone: cleanPhone, chatState: "paused" }),
          }).catch(() => {});
          // Re-enqueue para tentar novamente em 2 minutos (não grava no banco)
          await supabase.from("auto_reply_queue").update({
            status: "pending",
            scheduled_for: new Date(Date.now() + 120000).toISOString(),
            pending_since: new Date().toISOString(),
          }).eq("id", item.id);
          continue;
        }

        // Stop typing indicator
        await fetch(`${zapiBaseUrl}/send-chat-state`, {
          method: "POST",
          headers: zapiHeaders,
          body: JSON.stringify({ phone: cleanPhone, chatState: "paused" }),
        }).catch(() => {});

        // Save outbound message — apenas após confirmação do Z-API
        const { data: savedAiMessage } = await supabase.from("messages").insert({
          ticket_id: item.ticket_id,
          store_id: item.store_id,
          content: responseText,
          direction: "outbound",
          message_type: "text",
          source: "ai",
          zapi_message_id: sendResult.zapi_message_id,
          zapi_zaap_id: sendResult.zapi_zaap_id,
          zapi_id: sendResult.zapi_id,
          zapi_response: sendResult.zapi_response,
          delivery_status: "sent_to_zapi",
          delivery_updated_at: new Date().toISOString(),
        }).select("id").single();
        console.log("[MESSAGE SAVED]", JSON.stringify({ id: savedAiMessage?.id, origin: "ai_scheduler", zapi_message_id: sendResult.zapi_message_id, zapi_zaap_id: sendResult.zapi_zaap_id, zapi_id: sendResult.zapi_id }));

        // ── Detectar solicitação pendente (troca, endereço, tamanho, cancel, refund) ──
        try {
          const actionKeywords: Record<string, string[]> = {
            color_change: ['trocar a cor', 'mudar a cor', 'alterar a cor', 'cor diferente', 'outra cor'],
            size_change: ['trocar o tamanho', 'mudar o tamanho', 'alterar o tamanho', 'tamanho errado', 'outro tamanho'],
            address_update: ['alterar endereço', 'atualizar endereço', 'mudar endereço', 'adicionar número', 'complemento', 'endereço errado', 'novo endereço'],
            cancel: ['cancelar pedido', 'cancelamento', 'quero cancelar'],
            refund: ['reembolso', 'estorno', 'devolver o dinheiro', 'quero meu dinheiro de volta'],
          };

          const lastClientMessages = (messageHistory || [])
            .filter((m: any) => m.direction === 'inbound')
            .slice(-3)
            .map((m: any) => (m.content || '').toLowerCase())
            .join(' ');

          let detectedAction: string | null = null;
          for (const [action, keywords] of Object.entries(actionKeywords)) {
            if (keywords.some(kw => lastClientMessages.includes(kw))) {
              detectedAction = action;
              break;
            }
          }

          if (detectedAction && orders.length > 0) {
            const order: any = orders[0];

            // Evitar duplicar: já existe request pending do mesmo tipo p/ esse pedido?
            const { data: existing } = await supabase
              .from('requests')
              .select('id')
              .eq('ticket_id', item.ticket_id)
              .eq('type', detectedAction)
              .eq('status', 'pending')
              .maybeSingle();

            if (!existing) {
              const requestDetails: any = { raw_request: lastClientMessages };

              if (detectedAction === 'color_change') {
                const colorMatch = lastClientMessages.match(/(?:para|quero|mudar para|cor)\s+([a-záàãéêíóôõúç\s]+?)(?:\.|,|!|\?|$)/i);
                if (colorMatch) requestDetails.requested_color = colorMatch[1].trim().slice(0, 50);
              }
              if (detectedAction === 'size_change') {
                const sizeMatch = lastClientMessages.match(/(?:para|tamanho)\s+(pp|p|m|g|gg|xg|xgg|\d{2})\b/i);
                if (sizeMatch) requestDetails.requested_size = sizeMatch[1].toUpperCase();
              }
              if (detectedAction === 'address_update') {
                requestDetails.new_address = lastClientMessages.slice(0, 500);
              }

              await supabase.from('requests').insert({
                store_id: item.store_id,
                ticket_id: item.ticket_id,
                customer_phone: ticket.customer_phone,
                customer_name: ticket.customer_name,
                type: detectedAction,
                order_id: String(order.id || order.order_number || ''),
                order_name: order.name || order.order_number || null,
                description: lastClientMessages.slice(0, 300),
                details: requestDetails,
                status: 'pending',
              });

              console.log(`[REQUEST CREATED] ${detectedAction} para pedido ${order.name || order.order_number}`);
            }
          }
        } catch (e) {
          console.error('[REQUEST DETECTION] erro não-fatal:', e);
        }

        // Update ticket
        await supabase.from("tickets").update({
          last_message_at: new Date().toISOString(),
          sentiment,
        }).eq("id", item.ticket_id);

        // Salvar fatos extraídos na memória do cliente
        const factsNote = Object.values(facts).some(v => v !== null)
          ? `Produto interesse: ${facts.produto || ''} ${facts.cor || ''} ${facts.tamanho || ''}. Prazo: ${facts.prazo_desejado || ''}. CEP: ${facts.cep || ''}`.trim()
          : memory?.notes || null;

        await supabase.from("customer_memory").upsert({
          store_id: item.store_id,
          customer_phone: ticket.customer_phone,
          customer_name: ticket.customer_name || memory?.customer_name || null,
          notes: factsNote,
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
