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
    const restHeaders = {
      "X-Shopify-Access-Token": accessToken,
      "Content-Type": "application/json",
    };

    // Limpar telefone e gerar variantes
    const cleanPhone = customer_phone?.replace(/\D/g, "") || "";

    if (!cleanPhone) {
      return new Response(
        JSON.stringify({ orders: [] }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const phoneWithoutCountry = cleanPhone.startsWith("55")
      ? cleanPhone.slice(2)
      : cleanPhone;

    const phoneVariants = [
      cleanPhone,
      `+${cleanPhone}`,
      phoneWithoutCountry,
      `+55${phoneWithoutCountry}`,
      `55${phoneWithoutCountry}`,
    ].filter((v, i, arr) => arr.indexOf(v) === i);

    let orders: any[] = [];

    // Buscar por cada variante do telefone — parar na primeira que achar
    for (const phone of phoneVariants) {
      if (orders.length > 0) break;
      try {
        const res = await fetch(
          `https://${shopifyUrl}/admin/api/2024-01/customers/search.json?query=phone:${encodeURIComponent(phone)}&limit=5`,
          { headers: restHeaders }
        );
        if (res.ok) {
          const data = await res.json();
          if (data.customers?.length > 0) {
            const customerId = data.customers[0].id;
            const ordersRes = await fetch(
              `https://${shopifyUrl}/admin/api/2024-01/orders.json?customer_id=${customerId}&status=any&limit=10`,
              { headers: restHeaders }
            );
            if (ordersRes.ok) {
              const ordersData = await ordersRes.json();
              orders = ordersData.orders || [];
              console.log(`[Shopify] Encontrado pelo telefone ${phone}: ${orders.length} pedidos`);
              break;
            }
          }
        }
      } catch (e) {
        console.error(`[Shopify] Erro buscando telefone ${phone}:`, e);
      }
    }

    // Formatar pedidos
    const formatted = orders.map((o: any) => ({
      id: o.id,
      order_number: o.order_number,
      name: o.name,
      status: o.fulfillment_status || "unfulfilled",
      financial_status: o.financial_status,
      total_price: o.total_price,
      currency: o.currency,
      created_at: o.created_at,
      customer_email: o.email,
      customer_name: `${o.customer?.first_name || ""} ${o.customer?.last_name || ""}`.trim(),
      tracking_number: o.fulfillments?.[0]?.tracking_number || null,
      tracking_url: o.fulfillments?.[0]?.tracking_url || null,
      items: (o.line_items || []).map((i: any) => ({
        title: i.title,
        quantity: i.quantity,
        price: i.price,
        variant_title: i.variant_title,
      })),
    }));

    console.log(`[Shopify] Retornando ${formatted.length} pedidos formatados`);

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
