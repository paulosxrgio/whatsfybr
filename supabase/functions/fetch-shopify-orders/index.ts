import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

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
      .select("shopify_store_url, shopify_client_secret")
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

    const accessToken = settings.shopify_client_secret;
    const graphqlEndpoint = `https://${shopifyUrl}/admin/api/2024-01/graphql.json`;
    const headers = {
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
    const ddd = withoutCountry.slice(0, 2);
    const num = withoutCountry.slice(2);

    const phoneVariants = [
      `+55${withoutCountry}`,
      `+55 ${ddd} ${num.slice(0, 5)}-${num.slice(5)}`,
      `+55 ${ddd} ${num}`,
      `55${withoutCountry}`,
      withoutCountry,
      cleanPhone,
    ].filter((v, i, arr) => v && arr.indexOf(v) === i);

    // GraphQL query para buscar cliente por telefone
    const customerQuery = (phone: string) => JSON.stringify({
      query: `{
        customers(first: 5, query: "phone:\\"${phone}\\"") {
          edges {
            node {
              id
              firstName
              lastName
              email
              phone
              orders(first: 10, sortKey: CREATED_AT, reverse: true) {
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
          }
        }
      }`
    });

    let customerNode: any = null;

    // ESTRATÉGIA 1: Buscar cliente via GraphQL por cada variante de telefone
    for (const phone of phoneVariants) {
      try {
        const res = await fetch(graphqlEndpoint, {
          method: "POST",
          headers,
          body: customerQuery(phone),
        });
        if (res.ok) {
          const data = await res.json();
          const customers = data?.data?.customers?.edges;
          if (customers?.length > 0) {
            customerNode = customers[0].node;
            console.log(`[Shopify] Cliente encontrado via GraphQL, telefone "${phone}": ${customerNode.id}`);
            break;
          }
        }
      } catch (e) {
        console.error(`[Shopify] GraphQL erro variante ${phone}:`, e);
      }
    }

    // ESTRATÉGIA 2: Fallback - buscar nos pedidos recentes
    if (!customerNode) {
      console.log("[Shopify] Não achou cliente, buscando nos pedidos recentes...");
      try {
        const res = await fetch(graphqlEndpoint, {
          method: "POST",
          headers,
          body: JSON.stringify({
            query: `{
              orders(first: 50, query: "status:any") {
                edges {
                  node {
                    id
                    name
                    displayFinancialStatus
                    displayFulfillmentStatus
                    totalPriceSet { shopMoney { amount currencyCode } }
                    createdAt
                    email
                    phone
                    customer { id firstName lastName phone email }
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
            }`
          }),
        });
        if (res.ok) {
          const data = await res.json();
          const allOrders = data?.data?.orders?.edges?.map((e: any) => e.node) || [];

          const matched = allOrders.filter((o: any) => {
            const orderPhone = (o.phone || o.customer?.phone || "").replace(/\D/g, "");
            return orderPhone && (
              orderPhone.includes(withoutCountry) ||
              withoutCountry.includes(orderPhone.slice(-8)) ||
              orderPhone.endsWith(withoutCountry.slice(-8))
            );
          });

          if (matched.length > 0) {
            const formatted = matched.map((o: any) => ({
              id: o.id,
              order_number: o.name?.replace("#", ""),
              name: o.name,
              status: o.displayFulfillmentStatus?.toLowerCase() || "unfulfilled",
              financial_status: o.displayFinancialStatus?.toLowerCase() || "pending",
              total_price: o.totalPriceSet?.shopMoney?.amount,
              currency: o.totalPriceSet?.shopMoney?.currencyCode,
              created_at: o.createdAt,
              customer_email: o.email,
              customer_name: `${o.customer?.firstName || ""} ${o.customer?.lastName || ""}`.trim(),
              tracking_number: o.fulfillments?.[0]?.trackingInfo?.[0]?.number || null,
              tracking_url: o.fulfillments?.[0]?.trackingInfo?.[0]?.url || null,
              items: o.lineItems?.edges?.map((e: any) => ({
                title: e.node.title,
                quantity: e.node.quantity,
                price: e.node.originalUnitPriceSet?.shopMoney?.amount,
                variant_title: e.node.variant?.title,
              })) || [],
            }));

            console.log(`[Shopify] ${formatted.length} pedidos encontrados via fallback para ${cleanPhone}`);
            return new Response(
              JSON.stringify({ orders: formatted }),
              { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
            );
          }
        }
      } catch (e) {
        console.error("[Shopify] Erro fallback orders:", e);
      }
    }

    if (!customerNode) {
      console.log(`[Shopify] Nenhum cliente encontrado para ${cleanPhone}`);
      return new Response(
        JSON.stringify({ orders: [] }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Formatar pedidos do cliente encontrado
    const orders = customerNode.orders?.edges?.map((e: any) => e.node) || [];

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
      customer_name: `${customerNode.firstName || ""} ${customerNode.lastName || ""}`.trim(),
      tracking_number: o.fulfillments?.[0]?.trackingInfo?.[0]?.number || null,
      tracking_url: o.fulfillments?.[0]?.trackingInfo?.[0]?.url || null,
      items: o.lineItems?.edges?.map((e: any) => ({
        title: e.node.title,
        quantity: e.node.quantity,
        price: e.node.originalUnitPriceSet?.shopMoney?.amount,
        variant_title: e.node.variant?.title,
      })) || [],
    }));

    console.log(`[Shopify] ${formatted.length} pedidos encontrados para ${cleanPhone}`);
    return new Response(
      JSON.stringify({ orders: formatted }),
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
