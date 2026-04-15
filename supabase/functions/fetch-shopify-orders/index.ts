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
  if (!digits) return [];
  const variations: string[] = [];

  if (digits.length >= 12) {
    variations.push(`+${digits}`);
    variations.push(digits);
    if (digits.startsWith("55")) {
      variations.push(digits.slice(2));
      variations.push(`+55${digits.slice(2)}`);
    }
  } else {
    variations.push(`+55${digits}`);
    variations.push(`55${digits}`);
    variations.push(digits);
  }

  if (digits.length >= 9) {
    variations.push(digits.slice(-9));
  }

  return [...new Set(variations)];
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const { store_id, customer_phone, customer_name } = await req.json();

    if (!store_id) {
      return new Response(
        JSON.stringify({ error: "store_id é obrigatório" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
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

    const storeUrl = settings.shopify_store_url
      .replace(/^https?:\/\//, "")
      .replace(/\/admin.*$/, "")
      .replace(/\/+$/, "");

    // Determina access token: shpat_ usa direto, senão client_credentials
    let accessToken = settings.shopify_client_secret;

    if (!settings.shopify_client_secret.startsWith("shpat_") && settings.shopify_client_id) {
      console.log(`[Shopify] Obtendo token via client_credentials...`);
      const tokenRes = await fetch(`https://${storeUrl}/admin/oauth/access_token`, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          client_id: settings.shopify_client_id,
          client_secret: settings.shopify_client_secret,
          grant_type: "client_credentials",
        }).toString(),
      });

      if (!tokenRes.ok) {
        const errBody = await tokenRes.text();
        console.error(`[Shopify] Token falhou ${tokenRes.status}: ${errBody}`);
        return new Response(
          JSON.stringify({ error: "Falha ao autenticar na Shopify", orders: [] }),
          { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      const tokenData = await tokenRes.json();
      accessToken = tokenData.access_token;
    }

    const restHeaders = {
      "X-Shopify-Access-Token": accessToken,
      "Content-Type": "application/json",
    };

    let orders: any[] = [];

    // ── 1. Buscar por telefone (REST API, mais confiável para phone) ──
    const cleanPhone = customer_phone ? normalizePhone(customer_phone) : "";
    const phoneVariants = cleanPhone ? phoneSearchVariations(customer_phone) : [];

    for (const phone of phoneVariants) {
      if (orders.length > 0) break;
      try {
        const res = await fetch(
          `https://${storeUrl}/admin/api/2024-01/orders.json?phone=${encodeURIComponent(phone)}&status=any&limit=5`,
          { headers: restHeaders }
        );
        if (res.ok) {
          const data = await res.json();
          if (data.orders?.length > 0) {
            orders = data.orders;
            console.log(`[Shopify] ${data.orders.length} pedidos encontrados por phone: ${phone}`);
          }
        }
      } catch (e) {
        console.error(`[Shopify] Erro buscando por phone ${phone}:`, e);
      }
    }

    // ── 2. Se não achou por telefone, buscar por nome ──
    if (orders.length === 0 && customer_name) {
      const firstName = customer_name.split(" ")[0];
      console.log(`[Shopify] Buscando por nome: ${firstName}`);
      try {
        const res = await fetch(
          `https://${storeUrl}/admin/api/2024-01/orders.json?status=any&limit=10`,
          { headers: restHeaders }
        );
        if (res.ok) {
          const data = await res.json();
          orders = (data.orders || []).filter((o: any) => {
            const fullName = `${o.customer?.first_name || ""} ${o.customer?.last_name || ""}`.toLowerCase();
            return fullName.includes(firstName.toLowerCase());
          });
          if (orders.length > 0) {
            console.log(`[Shopify] ${orders.length} pedidos encontrados por nome: ${firstName}`);
          }
        }
      } catch (e) {
        console.error(`[Shopify] Erro buscando por nome:`, e);
      }
    }

    // ── 3. Deduplicate por id ──
    const seen = new Set();
    orders = orders.filter((o: any) => {
      if (seen.has(o.id)) return false;
      seen.add(o.id);
      return true;
    });

    // ── 4. Formatar para o frontend ──
    const formatted = orders.slice(0, 5).map((o: any) => ({
      id: o.id,
      order_number: o.name,
      created_at: o.created_at,
      financial_status: o.financial_status || "unknown",
      fulfillment_status: o.fulfillment_status || "unfulfilled",
      total_price: o.total_price || "0",
      currency: o.currency || "BRL",
      customer_email: o.email || null,
      customer_name: `${o.customer?.first_name || ""} ${o.customer?.last_name || ""}`.trim(),
      tracking_number: o.fulfillments?.[0]?.tracking_number || null,
      tracking_url: o.fulfillments?.[0]?.tracking_url || null,
      tracking_company: o.fulfillments?.[0]?.tracking_company || null,
      line_items: (o.line_items || []).map((i: any) => ({
        title: i.title,
        quantity: i.quantity,
        price: i.price,
        variant: i.variant_title || null,
      })),
    }));

    console.log(`[Shopify] Retornando ${formatted.length} pedidos formatados`);

    return new Response(
      JSON.stringify({
        orders: formatted,
        customer: formatted.length > 0
          ? { name: formatted[0].customer_name, email: formatted[0].customer_email }
          : null,
      }),
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
