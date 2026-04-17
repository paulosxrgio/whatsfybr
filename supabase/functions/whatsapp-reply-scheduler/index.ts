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

    console.log(`[SCHEDULER] Processando ${queue?.length || 0} itens da fila`);

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
        const aiModel = acctSettings?.ai_model || "gpt-4o-mini";
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
              ? '[cliente enviou uma imagem]'
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
- "Me conta mais"

━━━━━━━━━━━━━━━━━━━━━━
REGRA ANTI-REPETIÇÃO — CRÍTICA
━━━━━━━━━━━━━━━━━━━━━━

Antes de fazer qualquer pergunta, verifique o histórico da conversa.
Se o cliente já respondeu essa pergunta antes, NÃO pergunte de novo.
Se o cliente repetiu a mesma informação mais de uma vez, reconheça isso:
"Desculpe, vi que você já tinha me dito sobre o Vestido Daphne. Vou responder agora..."

NUNCA peça uma informação que já apareceu no histórico acima.
NUNCA ignore uma informação que o cliente forneceu.
Se o cliente disse o produto, cor e tamanho — você já sabe. Use essa informação.

━━━━━━━━━━━━━━━━━━━━━━
SOBRE IMAGENS RECEBIDAS
━━━━━━━━━━━━━━━━━━━━━━

Se o cliente mencionar que enviou uma foto ou imagem e você não conseguir ver o conteúdo, diga claramente:
"Recebi sua imagem, mas infelizmente não consigo visualizar fotos por aqui. Pode me descrever o produto ou me dizer o nome dele?"

NUNCA ignore que uma imagem foi enviada. Sempre reconheça o envio.

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
PEDIDOS DE OUTRAS LOJAS
━━━━━━━━━━━━━━━━━━━━━━

Se o cliente mencionar número de pedido que NÃO começa com os prefixos da loja,
ou se a busca Shopify não retornar nenhum pedido, responda IMEDIATAMENTE:

"Oi [Nome]! Não encontrei esse pedido aqui na ${storeName}.
Parece que sua compra foi feita em outra loja.
Para resolver, entre em contato com a loja onde o pagamento foi concluído,
pelo email de confirmação que você recebeu na compra.
Se tiver pedidos feitos aqui na ${storeName}, é só me chamar! 😊
Abraços, Sophia"

NUNCA tente "verificar" um pedido que não existe no sistema.
NUNCA diga "vou verificar" sem ter os dados reais do pedido no contexto.
NUNCA invente status, rastreamento ou informações sobre pedidos não encontrados.

Sinais de que o pedido é de outra loja:
- Número de pedido com formato diferente (ex: #27732 sem prefixo da loja)
- Cliente menciona nomes como: Patroa, Maria Alice, Shopee, Mercado Livre, Magazine Luiza, AliExpress
- Pedido não aparece na busca Shopify
- Cliente menciona que encontrou o produto "na internet" em outro lugar`;

        const systemPrompt = `${baseSystemPrompt}\n\n${modePrompt}${settings.ai_system_prompt ? `\n\n━━━━━━━━━━━━━━━━━━━━━━\nREGRAS ESPECÍFICAS DESTA LOJA\n━━━━━━━━━━━━━━━━━━━━━━\n\n${settings.ai_system_prompt}` : ""}`;

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

        // ── Buscar pedidos Shopify para contexto ──
        let orderContext = "Nenhum pedido Shopify encontrado para este cliente.";
        try {
          const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
          const supabaseAnonKey = Deno.env.get("SUPABASE_ANON_KEY") || Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
          const ordersRes = await fetch(`${supabaseUrl}/functions/v1/fetch-shopify-orders`, {
            method: "POST",
            headers: { "Content-Type": "application/json", "Authorization": `Bearer ${supabaseAnonKey}` },
            body: JSON.stringify({ store_id: item.store_id, customer_phone: ticket.customer_phone, customer_name: ticket.customer_name }),
          });
          if (ordersRes.ok) {
            const ordersData = await ordersRes.json();
            const orders = ordersData?.orders || [];
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
          }
        } catch (e) {
          console.error("Erro ao buscar pedidos Shopify:", e);
        }

        // Detectar se o cliente mencionou pedido de outra loja
        const mentionedOrderNumber = consolidatedInput.match(/#?\d{4,}/)?.[0];
        const foundInShopify = orderContext !== "Nenhum pedido Shopify encontrado para este cliente.";

        const wrongStoreContext = mentionedOrderNumber && !foundInShopify
          ? `ATENÇÃO CRÍTICA: O cliente mencionou o pedido ${mentionedOrderNumber} mas esse pedido NÃO existe na loja ${storeName} no Shopify. Provavelmente é de outra loja. Informe isso claramente e oriente o cliente a contatar a loja correta. NÃO invente informações sobre esse pedido.`
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

${orderContext}

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
              content: msg.message_type === "image" ? "[cliente enviou uma imagem]"
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
