import { corsHeaders } from "https://esm.sh/@supabase/supabase-js@2/cors";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const { store_url, access_token } = await req.json();

    if (!store_url || !access_token) {
      return new Response(
        JSON.stringify({ success: false, error: "URL da loja e token são obrigatórios" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const cleanUrl = store_url.replace(/^https?:\/\//, "").replace(/\/$/, "");
    const graphqlUrl = `https://${cleanUrl}/admin/api/2024-01/graphql.json`;

    // Query leve: apenas nome da loja
    const query = `query { shop { name myshopifyDomain } }`;

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10000);

    const res = await fetch(graphqlUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Shopify-Access-Token": access_token,
      },
      body: JSON.stringify({ query }),
      signal: controller.signal,
    });

    clearTimeout(timeout);

    if (!res.ok) {
      const body = await res.text();
      console.error(`[Shopify Verify] HTTP ${res.status}: ${body}`);

      const errorMap: Record<number, string> = {
        401: "Token inválido ou revogado. Verifique o Admin API access token.",
        403: "Sem permissão. O token não tem acesso à API Admin.",
        404: "Loja não encontrada. Verifique a URL.",
      };

      return new Response(
        JSON.stringify({
          success: false,
          error: errorMap[res.status] || `Erro HTTP ${res.status}: ${res.statusText}`,
          status: res.status,
        }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const data = await res.json();

    if (data.errors) {
      return new Response(
        JSON.stringify({
          success: false,
          error: "Erro na API Shopify: " + data.errors[0]?.message,
        }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const shopName = data?.data?.shop?.name;
    const domain = data?.data?.shop?.myshopifyDomain;

    return new Response(
      JSON.stringify({
        success: true,
        message: `Conexão válida! Loja: ${shopName} (${domain})`,
        shop_name: shopName,
        domain,
      }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (err) {
    if (err.name === "AbortError") {
      return new Response(
        JSON.stringify({ success: false, error: "Timeout: a Shopify não respondeu em 10s." }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }
    console.error("[Shopify Verify] Erro:", err);
    return new Response(
      JSON.stringify({ success: false, error: "Erro interno ao verificar conexão" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
