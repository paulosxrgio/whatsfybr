import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const CEREBRO_MEMORY = `Você é o Cérebro, supervisor silencioso da Sophia (atendente WhatsApp da Adorisse).

PRINCÍPIOS:
- Um erro grave vale mais que dez erros leves
- Antes de sugerir correções, verifique se já foram aplicadas antes
- Máximo 3 novas regras por análise (evita prompt inflado)
- Priorize erros graves: loops, promessas falsas, informações erradas, perguntas repetidas
- Priorize exemplos reais em vez de regras abstratas
- Contexto importa: erro às 2h da manhã pode ser spam, não da Sophia

O QUE NÃO MUDAR NA SOPHIA:
- Tom empático
- Regra de não pedir email sem necessidade
- Sistema de rastreamento via parcelpanel`;

const buildSupervisorPrompt = (memory: string) => `${memory}

Você vai analisar conversas e identificar:
1. Erros da atendente (loops, respostas erradas, promessas não cumpridas)
2. Padrões de perguntas dos clientes que não estão sendo bem respondidas
3. Melhorias específicas no prompt (MÁXIMO 3 novas regras)

Responda APENAS em JSON no formato:
{
  "score": 0-10,
  "critical_errors": ["erro1", "erro2"],
  "patterns_found": ["padrão1", "padrão2"],
  "prompt_additions": ["regra nova 1", "regra nova 2"],
  "summary": "resumo em 3 linhas"
}`;

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    const body = await req.json().catch(() => ({}));
    const { storeId } = body;

    if (!storeId) {
      return new Response(JSON.stringify({ error: "storeId required" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // 1. Buscar conversas das últimas 24h
    const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();

    const { data: tickets } = await supabase
      .from("tickets")
      .select("id, customer_name, customer_phone")
      .eq("store_id", storeId)
      .gte("last_message_at", since);

    if (!tickets?.length) {
      return new Response(JSON.stringify({ message: "no tickets" }), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // 2. Buscar mensagens de cada ticket (máx 20 tickets)
    const conversations: any[] = [];
    for (const ticket of tickets.slice(0, 20)) {
      const { data: messages } = await supabase
        .from("messages")
        .select("content, direction, created_at, message_type")
        .eq("ticket_id", ticket.id)
        .order("created_at", { ascending: true })
        .limit(30);

      if (messages?.length) {
        conversations.push({
          customer: ticket.customer_name,
          messages: messages.map((m: any) => ({
            role: m.direction === "inbound" ? "cliente" : "sophia",
            content: m.content,
            type: m.message_type,
          })),
        });
      }
    }

    // 3. Buscar config de IA da loja (provider/keys)
    const { data: settings } = await supabase
      .from("settings")
      .select("ai_provider, ai_model, openai_api_key, anthropic_api_key, ai_system_prompt, zapi_instance_id, zapi_token, zapi_client_token, cerebro_memory")
      .eq("store_id", storeId)
      .maybeSingle();

    const activeMemory = (settings as any)?.cerebro_memory || CEREBRO_MEMORY;
    const SUPERVISOR_SYSTEM_PROMPT = buildSupervisorPrompt(activeMemory);

    // 4. Enviar para IA analisar — preferir Lovable AI Gateway
    const lovableKey = Deno.env.get("LOVABLE_API_KEY");
    let analysisText = "{}";

    // Buscar últimos 7 relatórios para evitar repetir correções já aplicadas
    const { data: recentReports } = await supabase
      .from("supervisor_reports")
      .select("date, summary, prompt_additions")
      .eq("store_id", storeId)
      .order("date", { ascending: false })
      .limit(7);

    const pastCorrections = (recentReports && recentReports.length > 0)
      ? `\n\nCORREÇÕES JÁ APLICADAS NOS ÚLTIMOS 7 DIAS (NÃO REPITA):\n${recentReports.map((r: any) => {
          const adds = Array.isArray(r.prompt_additions) ? r.prompt_additions : [];
          return `${r.date}: ${adds.join(" | ") || "(sem novas regras)"}`;
        }).join("\n")}`
      : "";

    const userPrompt = `Analise estas ${conversations.length} conversas de hoje:\n\n${JSON.stringify(conversations, null, 2)}${pastCorrections}`;

    if (lovableKey) {
      const res = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${lovableKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: "google/gemini-2.5-pro",
          messages: [
            { role: "system", content: SUPERVISOR_SYSTEM_PROMPT },
            { role: "user", content: userPrompt },
          ],
          response_format: { type: "json_object" },
        }),
      });
      const data = await res.json();
      analysisText = data.choices?.[0]?.message?.content || "{}";
    } else if (settings?.anthropic_api_key) {
      const res = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: {
          "x-api-key": settings.anthropic_api_key,
          "anthropic-version": "2023-06-01",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: settings.ai_model || "claude-sonnet-4-20250514",
          max_tokens: 2000,
          system: SUPERVISOR_SYSTEM_PROMPT,
          messages: [{ role: "user", content: userPrompt }],
        }),
      });
      const data = await res.json();
      analysisText = data.content?.[0]?.text || "{}";
    } else {
      throw new Error("No AI provider configured");
    }

    let analysis: any;
    try {
      analysis = JSON.parse(analysisText.replace(/```json|```/g, "").trim());
    } catch {
      analysis = { score: 5, critical_errors: [], patterns_found: [], prompt_additions: [], summary: analysisText };
    }

    // 5. Se tem melhorias → atualizar o prompt automaticamente
    if (analysis.prompt_additions?.length > 0) {
      const currentPrompt = settings?.ai_system_prompt || "";
      const today = new Date().toLocaleDateString("pt-BR");

      const newRules = `\n\n━━━━━━━━━━━━━━━━━━━━━━
APRENDIZADOS DO DIA ${today} (auto-gerado)
━━━━━━━━━━━━━━━━━━━━━━
${analysis.prompt_additions.map((r: string) => `- ${r}`).join("\n")}`;

      await supabase
        .from("settings")
        .update({ ai_system_prompt: currentPrompt + newRules })
        .eq("store_id", storeId);

      console.log(`[SUPERVISOR] Prompt atualizado com ${analysis.prompt_additions.length} novas regras`);
    }

    // 6. Salvar relatório do dia
    await supabase.from("supervisor_reports").insert({
      store_id: storeId,
      date: new Date().toISOString().split("T")[0],
      tickets_analyzed: conversations.length,
      score: analysis.score,
      critical_errors: analysis.critical_errors || [],
      patterns_found: analysis.patterns_found || [],
      prompt_additions: analysis.prompt_additions || [],
      summary: analysis.summary,
    });

    // 7. Enviar resumo para WhatsApp se score baixo ou erros críticos
    if ((analysis.score < 7 || analysis.critical_errors?.length > 0) && settings?.zapi_instance_id && settings?.zapi_token) {
      const alertMessage = `🤖 *Relatório Diário Sophia*\n\n`
        + `📊 Score: ${analysis.score}/10\n`
        + `❌ Erros críticos: ${analysis.critical_errors?.length || 0}\n`
        + `📈 Melhorias aplicadas: ${analysis.prompt_additions?.length || 0}\n\n`
        + `📝 Resumo: ${analysis.summary}`;

      try {
        await fetch(`https://api.z-api.io/instances/${settings.zapi_instance_id}/token/${settings.zapi_token}/send-text`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            ...(settings.zapi_client_token ? { "Client-Token": settings.zapi_client_token } : {}),
          },
          body: JSON.stringify({
            phone: "553388756885",
            message: alertMessage,
          }),
        });
      } catch (e) {
        console.error("[SUPERVISOR] Failed to send WhatsApp alert:", e);
      }
    }

    return new Response(JSON.stringify(analysis), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("[SUPERVISOR] error:", e);
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : "unknown" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
