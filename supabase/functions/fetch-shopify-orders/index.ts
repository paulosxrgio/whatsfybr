import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// Normaliza telefone: remove tudo que não é dígito
function normalizePhone(phone: string): string {
  return phone.replace(/\D/g, "");
}

// Gera variações de busca para o telefone
function phoneSearchVariations(raw: string): string[] {
  const digits = normalizePhone(raw);
  const variations: string[] = [];

  // Com + e código do país
  if (digits.length >= 12) {
    variations.push(`+${digits}`);
    variations.push(digits);
    // Sem código do país (remove 55 do Brasil)
    if (digits.startsWith("55")) {
      variations.push(digits.slice(2));
    }
  } else {
    variations.push(`+55${digits}`);
    variations.push(`55${digits}`);
    variations.push(digits);
  }

  // Últimos 9 dígitos (número local sem DDD em alguns casos)
  if (digits.length >= 9) {
    variations.push(digits.slice(-9));
  }

  return [...new Set(variations)];
}

// Busca customer na Shopify por telefone usando GraphQL
async function findCustomerByPhone(
  storeUrl: string,
  accessToken: string,
  phoneVariations: string[]
): Promise<{ id: string; legacyId: string; displayName: string } | null> {
  const graphqlUrl = `https://${storeUrl}/admin/api/2024-01/graphql.json`;

  for (const phone of phoneVariations) {
    const query = `
      query {
        customers(first: 3, query: "phone:${phone}") {
          edges {
            node {
              id
              legacyResourceId
              displayName
              phone
            }
          }
        }
      }
    `;

    console.log(`[Shopify] Buscando customer com phone: ${phone}`);

    const res = await fetch(graphqlUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Shopify-Access-Token": accessToken,
      },
      body: JSON.stringify({ query }),
    });

    if (!res.ok) {
      console.error(`[Shopify] GraphQL HTTP ${res.status}: ${res.statusText}`);
      continue;
    }

    const data = await res.json();

    if (data.errors) {
      console.error(`[Shopify] GraphQL errors:`, JSON.stringify(data.errors));
      continue;
    }

    const edges = data?.data?.customers?.edges;
    if (edges && edges.length > 0) {
      const customer = edges[0].node;
      console.log(`[Shopify] Customer encontrado: ${customer.displayName} (ID: ${customer.legacyResourceId})`);
      return {
        id: customer.id,
        legacyId: customer.legacyResourceId,
        displayName: customer.displayName,
      };
    }
  }

  return null;
}

// Busca últimos pedidos do customer
async function fetchCustomerOrders(
  storeUrl: string,
  accessToken: string,
  customerId: string
): Promise<any[]> {
  const graphqlUrl = `https://${storeUrl}/admin/api/2024-01/graphql.json`;

  const query = `
    query {
      orders(first: 5, sortKey: CREATED_AT, reverse: true, query: "customer_id:${customerId}") {
        edges {
          node {
            id
            name
            createdAt
            displayFinancialStatus
            displayFulfillmentStatus
            totalPriceSet {
              shopMoney {
                amount
                currencyCode
              }
            }
            lineItems(first: 10) {
              edges {
                node {
                  title
                  quantity
                  variant {
                    title
                  }
                }
              }
            }
            fulfillments {
              trackingInfo {
                number
                url
                company
              }
              status
            }
          }
        }
      }
    }
  `;

  const res = await fetch(graphqlUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Shopify-Access-Token": accessToken,
    },
    body: JSON.stringify({ query }),
  });

  if (!res.ok) {
    console.error(`[Shopify] Orders GraphQL HTTP ${res.status}`);
    return [];
  }

  const data = await res.json();

  if (data.errors) {
    console.error(`[Shopify] Orders errors:`, JSON.stringify(data.errors));
    return [];
  }

  const edges = data?.data?.orders?.edges || [];

  return edges.map((e: any) => {
    const order = e.node;
    const tracking = order.fulfillments?.[0]?.trackingInfo?.[0];

    return {
      order_number: order.name,
      created_at: order.createdAt,
      financial_status: order.displayFinancialStatus,
      fulfillment_status: order.displayFulfillmentStatus,
      total_price: order.totalPriceSet?.shopMoney?.amount,
      currency: order.totalPriceSet?.shopMoney?.currencyCode,
      tracking_number: tracking?.number || null,
      tracking_url: tracking?.url || null,
      tracking_company: tracking?.company || null,
      line_items: order.lineItems?.edges?.map((li: any) => ({
        title: li.node.title,
        quantity: li.node.quantity,
        variant: li.node.variant?.title || null,
      })) || [],
    };
  });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const { store_id, customer_phone } = await req.json();

    if (!store_id || !customer_phone) {
      return new Response(
        JSON.stringify({ error: "store_id e customer_phone são obrigatórios" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Busca settings da loja
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    const { data: settings, error: settingsError } = await supabase
      .from("settings")
      .select("shopify_store_url, shopify_client_id, shopify_client_secret")
      .eq("store_id", store_id)
      .maybeSingle();

    if (settingsError || !settings) {
      return new Response(
        JSON.stringify({ error: "Configurações da loja não encontradas" }),
        { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const { shopify_store_url, shopify_client_secret } = settings;

    if (!shopify_store_url || !shopify_client_secret) {
      return new Response(
        JSON.stringify({ error: "Shopify não configurada", configured: false }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // shopify_client_secret é usado como Admin API access token (shpat_...)
    const accessToken = shopify_client_secret;
    const storeUrl = shopify_store_url.replace(/^https?:\/\//, "").replace(/\/$/, "");

    // Gera variações de busca do telefone
    const variations = phoneSearchVariations(customer_phone);
    console.log(`[Shopify] Variações de busca para ${customer_phone}:`, variations);

    // Busca customer
    const customer = await findCustomerByPhone(storeUrl, accessToken, variations);

    if (!customer) {
      console.log(`[Shopify] Nenhum customer encontrado para ${customer_phone}`);
      return new Response(
        JSON.stringify({ orders: [], customer: null, message: "Cliente não encontrado na Shopify" }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Busca pedidos
    const orders = await fetchCustomerOrders(storeUrl, accessToken, customer.legacyId);

    console.log(`[Shopify] ${orders.length} pedidos encontrados para ${customer.displayName}`);

    return new Response(
      JSON.stringify({
        orders,
        customer: { name: customer.displayName, id: customer.legacyId },
      }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (err) {
    console.error("[Shopify] Erro:", err);
    return new Response(
      JSON.stringify({ error: "Erro interno ao buscar pedidos" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
