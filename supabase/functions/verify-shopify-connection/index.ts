import { corsHeaders } from "https://esm.sh/@supabase/supabase-js@2/cors";

// Normaliza store_url para formato limpo: loja.myshopify.com
function normalizeStoreUrl(raw: string): string {
  return raw
    .replace(/^https?:\/\//, "")
    .replace(/\/admin.*$/, "")
    .replace(/\/+$/, "")
    .trim();
}

// Tenta obter access token via client_credentials grant
async function getAccessToken(
  storeUrl: string,
  clientId: string,
  clientSecret: string
): Promise<{ success: boolean; accessToken?: string; error?: string; status?: number }> {
  const tokenUrl = `https://${storeUrl}/admin/oauth/access_token`;

  console.log(`[Shopify Verify] Tentando client_credentials em ${tokenUrl}`);
  console.log(`[Shopify Verify] client_id: ${clientId.slice(0, 8)}...`);
  console.log(`[Shopify Verify] client_secret: ${clientSecret.slice(0, 8)}...`);

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10000);

  try {
    const res = await fetch(tokenUrl, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: clientId,
        client_secret: clientSecret,
        grant_type: "client_credentials",
      }).toString(),
      signal: controller.signal,
    });

    clearTimeout(timeout);

    if (!res.ok) {
      const body = await res.text();
      console.error(`[Shopify Verify] Token HTTP ${res.status}: ${body}`);
      return { success: false, error: body, status: res.status };
    }

    const data = await res.json();
    if (!data.access_token) {
      console.error(`[Shopify Verify] Token response sem access_token:`, JSON.stringify(data));
      return { success: false, error: "Resposta sem access_token", status: 200 };
    }

    console.log(`[Shopify Verify] Token obtido com sucesso (${data.access_token.slice(0, 10)}...)`);
    return { success: true, accessToken: data.access_token };
  } catch (err) {
    clearTimeout(timeout);
    if (err.name === "AbortError") {
      return { success: false, error: "Timeout ao obter token", status: 0 };
    }
    return { success: false, error: String(err), status: 0 };
  }
}

// Testa acesso direto com token shpat_ (Admin API access token)
async function testDirectToken(
  storeUrl: string,
  token: string
): Promise<{ success: boolean; shopName?: string; domain?: string; error?: string; status?: number }> {
  const graphqlUrl = `https://${storeUrl}/admin/api/2024-01/graphql.json`;
  const query = `query { shop { name myshopifyDomain } }`;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10000);

  try {
    const res = await fetch(graphqlUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Shopify-Access-Token": token,
      },
      body: JSON.stringify({ query }),
      signal: controller.signal,
    });

    clearTimeout(timeout);

    if (!res.ok) {
      const body = await res.text();
      console.error(`[Shopify Verify] GraphQL HTTP ${res.status}: ${body}`);
      return { success: false, error: body, status: res.status };
    }

    const data = await res.json();
    if (data.errors) {
      return { success: false, error: data.errors[0]?.message || "GraphQL error", status: 200 };
    }

    return {
      success: true,
      shopName: data?.data?.shop?.name,
      domain: data?.data?.shop?.myshopifyDomain,
    };
  } catch (err) {
    clearTimeout(timeout);
    if (err.name === "AbortError") {
      return { success: false, error: "Timeout na chamada GraphQL", status: 0 };
    }
    return { success: false, error: String(err), status: 0 };
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const { store_url, access_token, client_id, client_secret } = await req.json();

    if (!store_url) {
      return new Response(
        JSON.stringify({ success: false, step: "validation", error: "URL da loja é obrigatória" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const storeUrl = normalizeStoreUrl(store_url);
    console.log(`[Shopify Verify] Store URL normalizada: ${storeUrl}`);

    // Valida formato *.myshopify.com
    if (!storeUrl.endsWith(".myshopify.com")) {
      return new Response(
        JSON.stringify({
          success: false,
          step: "validation",
          error: "A URL deve ser no formato loja.myshopify.com",
        }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Estratégia 1: Se recebeu access_token direto (shpat_...), testa direto
    if (access_token && access_token.startsWith("shpat_")) {
      console.log(`[Shopify Verify] Usando access_token direto (shpat_...)`);
      const result = await testDirectToken(storeUrl, access_token);

      if (result.success) {
        return new Response(
          JSON.stringify({
            success: true,
            step: "graphql",
            message: `Conexão válida! Loja: ${result.shopName} (${result.domain})`,
            shop_name: result.shopName,
            domain: result.domain,
          }),
          { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      return new Response(
        JSON.stringify({
          success: false,
          step: "graphql",
          status: result.status,
          error: result.status === 401
            ? "Admin API access token inválido ou revogado."
            : result.status === 403
            ? "Token sem permissão para acessar a API Admin."
            : result.error || "Erro ao testar token",
        }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Estratégia 2: Usar client_id + client_secret para obter token via client_credentials
    const cId = client_id || "";
    const cSecret = access_token || client_secret || "";

    if (!cId || !cSecret) {
      return new Response(
        JSON.stringify({
          success: false,
          step: "validation",
          error: "Forneça Client ID + Client Secret ou um Admin API access token (shpat_...)",
        }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Passo 1: Obter access_token via client_credentials
    console.log(`[Shopify Verify] Usando fluxo client_credentials`);
    const tokenResult = await getAccessToken(storeUrl, cId, cSecret);

    if (!tokenResult.success) {
      // Diferenciar erros do passo de token
      let errorMsg = "Falha ao obter access token.";
      if (tokenResult.status === 401 || tokenResult.status === 400) {
        errorMsg = "Client ID ou Client Secret inválidos. Verifique as credenciais.";
      } else if (tokenResult.status === 404) {
        errorMsg = "Loja não encontrada. Verifique a URL.";
      } else if (tokenResult.error?.includes("not_found") || tokenResult.error?.includes("Not Found")) {
        errorMsg = "Endpoint não encontrado. Verifique se o app Shopify suporta client_credentials. Apps públicos requerem fluxo OAuth com código de autorização.";
      }

      return new Response(
        JSON.stringify({
          success: false,
          step: "token",
          status: tokenResult.status,
          error: errorMsg,
          details: tokenResult.error,
        }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Passo 2: Testar o token obtido com GraphQL
    const graphqlResult = await testDirectToken(storeUrl, tokenResult.accessToken!);

    if (graphqlResult.success) {
      return new Response(
        JSON.stringify({
          success: true,
          step: "graphql",
          message: `Conexão válida! Loja: ${graphqlResult.shopName} (${graphqlResult.domain})`,
          shop_name: graphqlResult.shopName,
          domain: graphqlResult.domain,
        }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    return new Response(
      JSON.stringify({
        success: false,
        step: "graphql",
        status: graphqlResult.status,
        error: graphqlResult.status === 403
          ? "Token obtido mas sem permissão suficiente. Verifique os escopos do app."
          : graphqlResult.error || "Erro ao validar token com GraphQL",
      }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (err) {
    console.error("[Shopify Verify] Erro:", err);
    return new Response(
      JSON.stringify({ success: false, step: "validation", error: "Erro interno ao verificar conexão" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
