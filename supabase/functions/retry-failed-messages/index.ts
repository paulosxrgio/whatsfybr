import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const BATCH_SIZE = 30; // máximo por chamada (~5min com delay de 10s)
const DELAY_MS = 10_000;

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const { store_id } = await req.json();
    if (!store_id) {
      return new Response(JSON.stringify({ error: "store_id required" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Validar JWT do usuário
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return new Response(JSON.stringify({ error: "unauthorized" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const userClient = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: authHeader } } }
    );
    const { data: userData } = await userClient.auth.getUser();
    if (!userData?.user) {
      return new Response(JSON.stringify({ error: "unauthorized" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Service-role para UPDATE em messages (bypass RLS)
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    // Validar que a loja pertence ao usuário
    const { data: store } = await supabase
      .from("stores")
      .select("id")
      .eq("id", store_id)
      .eq("user_id", userData.user.id)
      .maybeSingle();
    if (!store) {
      return new Response(JSON.stringify({ error: "forbidden" }), {
        status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Pegar credenciais Z-API
    const { data: settings } = await supabase
      .from("settings")
      .select("zapi_instance_id, zapi_token, zapi_client_token")
      .eq("store_id", store_id)
      .single();
    if (!settings?.zapi_instance_id || !settings?.zapi_token) {
      return new Response(JSON.stringify({ error: "Z-API não configurada" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Buscar mensagens com falha (zapi_message_id null) das últimas 6h
    const sixHoursAgo = new Date(Date.now() - 6 * 60 * 60 * 1000).toISOString();
    const { data: failed, error: queryErr } = await supabase
      .from("messages")
      .select("id, ticket_id, content, created_at, tickets!inner(customer_phone, status, ai_paused)")
      .eq("store_id", store_id)
      .eq("direction", "outbound")
      .eq("source", "ai")
      .is("zapi_message_id", null)
      .gte("created_at", sixHoursAgo)
      .order("created_at", { ascending: true })
      .limit(BATCH_SIZE + 1);

    if (queryErr) throw queryErr;

    // Filtrar tickets ativos
    const eligible = (failed || []).filter((m: any) =>
      m.tickets?.status === "open" && m.tickets?.ai_paused === false && m.content
    );

    const hasMore = eligible.length > BATCH_SIZE;
    const toProcess = eligible.slice(0, BATCH_SIZE);

    let sent = 0;
    let failedCount = 0;
    const errors: Array<{ id: string; phone: string; error: string }> = [];
    const sendUrl = `${Deno.env.get("SUPABASE_URL")}/functions/v1/send-whatsapp-reply`;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    for (let i = 0; i < toProcess.length; i++) {
      const msg: any = toProcess[i];
      const phone = String(msg.tickets.customer_phone).replace(/\D/g, "");

      try {
        // Apaga o registro antigo "fantasma" e deixa send-whatsapp-reply criar um novo já confirmado.
        await supabase.from("messages").delete().eq("id", msg.id);

        const res = await fetch(sendUrl, {
          method: "POST",
          headers: { "Content-Type": "application/json", "Authorization": `Bearer ${serviceKey}` },
          body: JSON.stringify({
            ticket_id: msg.ticket_id,
            store_id,
            message: msg.content,
            source: "ai",
          }),
        });
        const data = await res.json().catch(() => ({} as any));
        if (!res.ok || !data?.ok) {
          failedCount++;
          errors.push({ id: msg.id, phone, error: data?.error || `HTTP ${res.status}` });
          console.error(`[RETRY FAIL] ${phone}:`, data);
        } else {
          sent++;
          console.log(`[RETRY OK] ${phone} -> ${data?.zapi_message_id}`);
        }
      } catch (e: any) {
        failedCount++;
        errors.push({ id: msg.id, phone, error: e.message || String(e) });
        console.error(`[RETRY ERR] ${phone}:`, e);
      }

      if (i < toProcess.length - 1) {
        await new Promise((r) => setTimeout(r, DELAY_MS));
      }
    }

    return new Response(
      JSON.stringify({
        ok: true,
        total: toProcess.length,
        sent,
        failed: failedCount,
        has_more: hasMore,
        errors: errors.slice(0, 10),
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (e: any) {
    console.error("retry-failed-messages error:", e);
    return new Response(JSON.stringify({ error: e.message || "internal error" }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
