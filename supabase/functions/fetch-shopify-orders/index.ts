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

    const cleanPhone = customer_phone?.replace(/\D/g, "") || "";

    if (!cleanPhone) {
      return new Response(
        JSON.stringify({ orders: [] }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Remover DDI 55 se existir para pegar o número local
    const withoutCountry = cleanPhone.startsWith("55") ? cleanPhone.slice(2) : cleanPhone;
    const ddd = withoutCountry.slice(0, 2);
    const num = withoutCountry.slice(2);

    // Gerar TODAS as variantes de formato possíveis no Shopify
    const phoneVariants = [
      cleanPhone,
      `+${cleanPhone}`,
      `+55${withoutCountry}`,
      withoutCountry,
      `+55 ${ddd} ${num.slice(0, 5)}-${num.slice(5)}`,
      `+55 ${ddd} ${num}`,
      `55 ${ddd} ${num.slice(0, 5)}-${num.slice(5)}`,
      `(${ddd}) ${num.slice(0, 5)}-${num.slice(5)}`,
      `${ddd} ${num.slice(0, 5)}-${num.slice(5)}`,
      `${ddd}${num}`,
    ].filter((v, i, arr) => arr.indexOf(v) === i);

    let customerId: string | null = null;
    let orders: any[] = [];

    // ESTRATÉGIA 1: customers/search por cada variante de telefone
    for (const phone of phoneVariants) {
      try {
        const res = await fetch(
          `https://${shopifyUrl}/admin/api/2024-01/customers/search.json?query=phone:${encodeURIComponent(phone)}&limit=5&fields=id,phone,email,first_name,last_name`,
          { headers: restHeaders }
        );
        if (res.ok) {
          const data = await res.json();
          if (data.customers?.length > 0) {
            customerId = data.customers[0].id;
            console.log(`[Shopify] Cliente encontrado por telefone "${phone}": ${customerId}`);
            break;
          }
        }
      } catch (e) {
        console.error(`[Shopify] Erro variante ${phone}:`, e);
      }
    }

    // ESTRATÉGIA 2: buscar direto nos pedidos recentes por telefone
    if (!customerId) {
      console.log("[Shopify] Não achou por customers/search, tentando orders direto...");
      try {
        const res = await fetch(
          `https://${shopifyUrl}/admin/api/2024-01/orders.json?status=any&limit=50&fields=id,order_number,name,phone,customer,financial_status,fulfillment_status,line_items,fulfillments,total_price,currency,created_at,email`,
          { headers: restHeaders }
        );
        if (res.ok) {
          const data = await res.json();
          const matched = data.orders?.filter((o: any) => {
            const orderPhone = (o.phone || o.customer?.phone || "").replace(/\D/g, "");
            return (
              orderPhone.includes(withoutCountry) ||
              withoutCountry.includes(orderPhone) ||
              orderPhone.endsWith(withoutCountry) ||
              cleanPhone.endsWith(orderPhone.replace(/^55/, ""))
            );
          });
          if (matched?.length > 0) {
            orders = matched;
            console.log(`[Shopify] Pedidos encontrados direto nos orders: ${orders.length}`);
          }
        }
      } catch (e) {
        console.error("[Shopify] Erro buscando orders direto:", e);
      }
    }

    // Se achou o customerId, buscar pedidos pelo cliente
    if (customerId && orders.length === 0) {
      try {
        const res = await fetch(
          `https://${shopifyUrl}/admin/api/2024-01/orders.json?customer_id=${customerId}&status=any&limit=10`,
          { headers: restHeaders }
        );
        if (res.ok) {
          const data = await res.json();
          orders = data.orders || [];
          console.log(`[Shopify] Pedidos por customer_id ${customerId}: ${orders.length}`);
        }
      } catch (e) {
        console.error("[Shopify] Erro buscando por customer_id:", e);
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

    console.log(`[Shopify] Total formatado: ${formatted.length} pedidos para ${cleanPhone}`);

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
