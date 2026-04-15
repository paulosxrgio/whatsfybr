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

    // Variantes SEM aspas na query, igual ao admin do Shopify
    const phoneVariants = [
      cleanPhone,
      withoutCountry,
      `+${cleanPhone}`,
    ];

    let customerId: string | null = null;
    let customerName = "";

    // ESTRATÉGIA 1: Buscar cliente via REST customers/search (sem prefixo phone:)
    for (const phone of phoneVariants) {
      try {
        const res = await fetch(
          `https://${shopifyUrl}/admin/api/2024-01/customers/search.json?query=${encodeURIComponent(phone)}&limit=5&fields=id,first_name,last_name,phone,email`,
          {
            headers: {
              "X-Shopify-Access-Token": accessToken,
              "Content-Type": "application/json",
            },
          }
        );
        if (res.ok) {
          const data = await res.json();
          console.log(`[Shopify] Busca "${phone}": ${data.customers?.length || 0} resultados`);
          if (data.customers?.length > 0) {
            customerId = String(data.customers[0].id);
            customerName = `${data.customers[0].first_name || ""} ${data.customers[0].last_name || ""}`.trim();
            console.log(`[Shopify] ENCONTRADO: ${customerId} — ${customerName} — ${data.customers[0].phone}`);
            break;
          }
        }
      } catch (e) {
        console.error(`[Shopify] Erro variante ${phone}:`, e);
      }
    }

    if (!customerId) {
      console.log(`[Shopify] Nenhum cliente encontrado para ${cleanPhone}`);
      return new Response(
        JSON.stringify({ orders: [], debug: `phone_tried: ${phoneVariants.join(", ")}` }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Com o customerId em mãos, buscar os pedidos desse cliente via REST
    const ordersRes = await fetch(
      `https://${shopifyUrl}/admin/api/2024-01/orders.json?customer_id=${customerId}&status=any&limit=10&fields=id,order_number,name,financial_status,fulfillment_status,total_price,currency,created_at,email,line_items,fulfillments`,
      {
        headers: {
          "X-Shopify-Access-Token": accessToken,
          "Content-Type": "application/json",
        },
      }
    );

    const ordersData = await ordersRes.json();
    const orders = ordersData?.orders || [];

    console.log(`[Shopify] ${orders.length} pedidos encontrados para customer ${customerId}`);

    const formatted = orders.map((o: any) => ({
      id: o.id,
      order_number: o.order_number,
      name: o.name,
      status: o.fulfillment_status || "unfulfilled",
      financial_status: o.financial_status || "pending",
      total_price: o.total_price,
      currency: o.currency,
      created_at: o.created_at,
      customer_email: o.email,
      customer_name: customerName,
      tracking_number: o.fulfillments?.[0]?.tracking_number || null,
      tracking_url: o.fulfillments?.[0]?.tracking_url || null,
      items: o.line_items?.map((i: any) => ({
        title: i.title,
        quantity: i.quantity,
        price: i.price,
        variant_title: i.variant_title,
      })) || [],
    }));

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
