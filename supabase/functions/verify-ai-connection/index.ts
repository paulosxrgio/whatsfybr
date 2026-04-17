import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

/**
 * Mapeia status HTTP da OpenAI para mensagens amigáveis ao usuário.
 */
function openaiErrorMessage(status: number, errorBody: any): string {
  const msg = errorBody?.error?.message || "";
  switch (status) {
    case 401:
      return "A chave da OpenAI é inválida, foi revogada ou não pertence ao projeto correto.";
    case 403:
      return "Sem permissão. Verifique se a chave tem acesso ao modelo selecionado.";
    case 429:
      return "Quota excedida ou limite de requisições atingido. Verifique seus créditos na OpenAI.";
    case 404:
      return `Modelo não encontrado. ${msg}`;
    default:
      if (status >= 500) return "Erro temporário nos servidores da OpenAI. Tente novamente em alguns minutos.";
      return msg || `Erro desconhecido (HTTP ${status})`;
  }
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const { provider, api_key, model } = await req.json();

    if (!provider || !api_key) {
      return new Response(JSON.stringify({ success: false, error: "Missing provider or api_key" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Mask key for logging (show first 8 + last 4 chars)
    const maskedKey = api_key.length > 12
      ? `${api_key.slice(0, 8)}...${api_key.slice(-4)}`
      : "***";

    if (provider === "openai") {
      // Usar a Responses API oficial: POST /v1/responses
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 15000);

      try {
        const res = await fetch("https://api.openai.com/v1/responses", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Authorization": `Bearer ${api_key}`,
          },
          body: JSON.stringify({
            model: model || "gpt-4o-mini",
            input: "Say ok",
            store: false,
            max_output_tokens: 16,
          }),
          signal: controller.signal,
        });
        clearTimeout(timeout);

        if (!res.ok) {
          let errorBody: any = {};
          try { errorBody = await res.json(); } catch { /* ignore parse errors */ }
          const friendlyMsg = openaiErrorMessage(res.status, errorBody);
          console.error(`OpenAI verify failed [${maskedKey}]: HTTP ${res.status}`, JSON.stringify(errorBody?.error || errorBody));
          return new Response(JSON.stringify({
            success: false,
            error: friendlyMsg,
            errorCode: errorBody?.error?.code || `http_${res.status}`,
            status: res.status,
          }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
        }

        const data = await res.json();
        // Verificar se a resposta contém output válido
        const outputText = data.output_text || data.output?.[0]?.content?.[0]?.text || "";
        if (!outputText) {
          console.error("OpenAI returned empty output:", JSON.stringify(data));
          return new Response(JSON.stringify({
            success: false,
            error: "A API retornou uma resposta vazia. Verifique o modelo selecionado.",
          }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
        }

        return new Response(JSON.stringify({ success: true }), {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      } catch (e) {
        clearTimeout(timeout);
        if (e.name === "AbortError") {
          return new Response(JSON.stringify({
            success: false,
            error: "Timeout: a OpenAI não respondeu em 15 segundos. Tente novamente.",
            errorCode: "timeout",
          }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
        }
        throw e;
      }
    }

    if (provider === "anthropic") {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 15000);

      try {
        const res = await fetch("https://api.anthropic.com/v1/messages", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "x-api-key": api_key,
            "anthropic-version": "2023-06-01",
          },
          body: JSON.stringify({
            model: model || "claude-sonnet-4-20250514",
            max_tokens: 5,
            messages: [{ role: "user", content: "Say ok" }],
          }),
          signal: controller.signal,
        });
        clearTimeout(timeout);

        const data = await res.json();
        if (!res.ok || data.error) {
          const msg = data.error?.message || `Erro HTTP ${res.status}`;
          console.error(`Anthropic verify failed [${maskedKey}]: HTTP ${res.status}`, JSON.stringify(data.error || data));
          return new Response(JSON.stringify({
            success: false,
            error: res.status === 401 ? "Chave Anthropic inválida ou revogada." :
                   res.status === 429 ? "Quota excedida na Anthropic." : msg,
            status: res.status,
          }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
        }

        return new Response(JSON.stringify({ success: true }), {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      } catch (e) {
        clearTimeout(timeout);
        if (e.name === "AbortError") {
          return new Response(JSON.stringify({
            success: false,
            error: "Timeout: a Anthropic não respondeu em 15 segundos.",
            errorCode: "timeout",
          }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
        }
        throw e;
      }
    }

    return new Response(JSON.stringify({ success: false, error: "Unknown provider" }), {
      status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("verify-ai-connection error:", e);
    return new Response(JSON.stringify({ success: false, error: e.message }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
