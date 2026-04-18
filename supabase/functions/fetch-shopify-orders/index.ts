import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// Obtém access token via client_credentials grant
async function getAccessToken(
  storeUrl: string,
  clientId: string,
  clientSecret: string
): Promise<string | null> {
  const tokenUrl = `https://${storeUrl}/admin/oauth/access_token`;
  try {
    const res = await fetch(tokenUrl, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: clientId,
        client_secret: clientSecret,
        grant_type: "client_credentials",
      }).toString(),
    });
    if (!res.ok) {
      console.error(`[Shopify] Token HTTP ${res.status}: ${await res.text()}`);
      return null;
    }
    const data = await res.json();
    if (!data.access_token) {
      console.error(`[Shopify] Token response sem access_token:`, JSON.stringify(data));
      return null;
    }
    console.log(`[Shopify] Access token obtido com sucesso`);
    return data.access_token;
  } catch (e) {
    console.error(`[Shopify] Erro ao obter token:`, e);
    return null;
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const { customer_phone, store_id } = await req.json();

    if (!store_id) {
      return new Response(
        JSON.stringify({ orders: [] }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    const { data: settings } = await supabase
      .from("settings")
      .select("shopify_store_url, shopify_client_id, shopify_client_secret")
      .eq("store_id", store_id)
      .maybeSingle();

    if (!settings?.shopify_store_url || !settings?.shopify_client_secret) {
      return new Response(
        JSON.stringify({ orders: [], configured: false }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const shopifyUrl = settings.shopify_store_url
      .replace(/^https?:\/\//, "")
      .replace(/\/admin.*$/, "")
      .replace(/\/+$/, "");

    // Determinar access token: se é shpat_ usa direto, senão faz client_credentials
    let accessToken: string | null = null;
    if (settings.shopify_client_secret.startsWith("shpat_")) {
      accessToken = settings.shopify_client_secret;
      console.log(`[Shopify] Usando access token direto (shpat_)`);
    } else if (settings.shopify_client_id && settings.shopify_client_secret) {
      accessToken = await getAccessToken(shopifyUrl, settings.shopify_client_id, settings.shopify_client_secret);
    }

    if (!accessToken) {
      console.error(`[Shopify] Não foi possível obter access token`);
      return new Response(
        JSON.stringify({ orders: [], error: "Token inválido" }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const graphqlEndpoint = `https://${shopifyUrl}/admin/api/2024-01/graphql.json`;
    const gqlHeaders = {
      "X-Shopify-Access-Token": accessToken,
      "Content-Type": "application/json",
    };

    const cleanPhone = customer_phone?.replace(/\D/g, "") || "";

    if (!cleanPhone) {
      return new Response(
        JSON.stringify({ orders: [] }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const withoutCountry = cleanPhone.startsWith("55") ? cleanPhone.slice(2) : cleanPhone;

    const phoneVariants = [
      cleanPhone,
      withoutCountry,
      `+${cleanPhone}`,
    ];

    let customerId: string | null = null;
    let customerName = "";
    let foundByEmail = false;

    // Buscar cliente via GraphQL por telefone
    for (const phone of phoneVariants) {
      try {
        const res = await fetch(graphqlEndpoint, {
          method: "POST",
          headers: gqlHeaders,
          body: JSON.stringify({
            query: `{
              customers(first: 5, query: "${phone}") {
                edges {
                  node {
                    id
                    firstName
                    lastName
                    phone
                  }
                }
              }
            }`
          }),
        });
        if (!res.ok) {
          console.error(`[Shopify] GraphQL HTTP ${res.status} para "${phone}": ${await res.text()}`);
          continue;
        }
        const data = await res.json();
        if (data.errors) {
          console.error(`[Shopify] GraphQL errors para "${phone}":`, JSON.stringify(data.errors));
          continue;
        }
        const customers = data?.data?.customers?.edges || [];
        console.log(`[Shopify] Busca "${phone}": ${customers.length} resultados`);
        if (customers.length > 0) {
          customerId = customers[0].node.id;
          customerName = `${customers[0].node.firstName || ""} ${customers[0].node.lastName || ""}`.trim();
          console.log(`[Shopify] ENCONTRADO: ${customerId} — ${customerName} — ${customers[0].node.phone}`);
          break;
        }
      } catch (e) {
        console.error(`[Shopify] Erro variante ${phone}:`, e);
      }
    }

    // FALLBACK: se não encontrou por telefone, buscar email salvo na customer_memory e tentar por email
    if (!customerId) {
      const { data: memory } = await supabase
        .from("customer_memory")
        .select("customer_email")
        .eq("store_id", store_id)
        .eq("customer_phone", cleanPhone)
        .maybeSingle();

      const savedEmail = memory?.customer_email;

      if (savedEmail) {
        console.log(`[Shopify] FALLBACK por email salvo: ${savedEmail}`);
        try {
          const res = await fetch(graphqlEndpoint, {
            method: "POST",
            headers: gqlHeaders,
            body: JSON.stringify({
              query: `{
                customers(first: 5, query: "email:${savedEmail}") {
                  edges {
                    node {
                      id
                      firstName
                      lastName
                      email
                    }
                  }
                }
              }`
            }),
          });
          if (res.ok) {
            const data = await res.json();
            const customers = data?.data?.customers?.edges || [];
            console.log(`[Shopify] Busca por email "${savedEmail}": ${customers.length} resultados`);
            if (customers.length > 0) {
              customerId = customers[0].node.id;
              customerName = `${customers[0].node.firstName || ""} ${customers[0].node.lastName || ""}`.trim();
              foundByEmail = true;
              console.log(`[Shopify] ENCONTRADO POR EMAIL: ${customerId} — ${customerName}`);
            }
          }
        } catch (e) {
          console.error(`[Shopify] Erro busca por email:`, e);
        }
      }
    }

    if (!customerId) {
      console.log(`[Shopify] Nenhum cliente encontrado para ${cleanPhone}`);
      return new Response(
        JSON.stringify({ orders: [], debug: `phone_tried: ${phoneVariants.join(", ")}` }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Buscar pedidos do cliente
    const ordersRes = await fetch(graphqlEndpoint, {
      method: "POST",
      headers: gqlHeaders,
      body: JSON.stringify({
        query: `{
          customer(id: "${customerId}") {
            orders(first: 10, sortKey: CREATED_AT, reverse: true, query: "financial_status:paid") {
              edges {
                node {
                  id
                  name
                  displayFinancialStatus
                  displayFulfillmentStatus
                  totalPriceSet { shopMoney { amount currencyCode } }
                  createdAt
                  email
                  lineItems(first: 10) {
                    edges {
                      node {
                        title
                        quantity
                        originalUnitPriceSet { shopMoney { amount currencyCode } }
                        variant { title }
                      }
                    }
                  }
                  fulfillments(first: 5) {
                    trackingInfo(first: 1) { number url }
                    status
                  }
                }
              }
            }
          }
        }`
      }),
    });

    if (!ordersRes.ok) {
      console.error(`[Shopify] Orders GraphQL HTTP ${ordersRes.status}: ${await ordersRes.text()}`);
      return new Response(
        JSON.stringify({ orders: [], error: "Erro ao buscar pedidos" }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const ordersData = await ordersRes.json();
    const orders = ordersData?.data?.customer?.orders?.edges?.map((e: any) => e.node) || [];

    console.log(`[Shopify] ${orders.length} pedidos encontrados para customer ${customerId}`);

    const formatted = orders.map((o: any) => ({
      id: o.id,
      order_number: o.name?.replace("#", ""),
      name: o.name,
      status: o.displayFulfillmentStatus?.toLowerCase() || "unfulfilled",
      financial_status: o.displayFinancialStatus?.toLowerCase() || "pending",
      total_price: o.totalPriceSet?.shopMoney?.amount,
      currency: o.totalPriceSet?.shopMoney?.currencyCode,
      created_at: o.createdAt,
      customer_email: o.email,
      customer_name: customerName,
      tracking_number: o.fulfillments?.[0]?.trackingInfo?.[0]?.number || null,
      tracking_url: o.fulfillments?.[0]?.trackingInfo?.[0]?.url || null,
      items: o.lineItems?.edges?.map((e: any) => ({
        title: e.node.title,
        quantity: e.node.quantity,
        price: e.node.originalUnitPriceSet?.shopMoney?.amount,
        variant_title: e.node.variant?.title,
      })) || [],
    }));

    return new Response(
      JSON.stringify({ orders: formatted, found_by_email: foundByEmail }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (err) {
    console.error("[Shopify] Erro:", err);
    return new Response(
      JSON.stringify({ error: "Erro interno ao buscar pedidos", orders: [] }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
