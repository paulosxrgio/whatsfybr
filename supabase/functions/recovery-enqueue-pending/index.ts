// Enfileira tickets pendentes para retomada de atendimento.
// Regras:
// - Só tickets abertos cuja ÚLTIMA mensagem é inbound (cliente falou por último).
// - Sem outbound nas últimas 24h (não pisar em conversas recentes).
// - Sem retomada já enviada nas últimas 24h (recovery_message_sent_at).
// - Não cria duplicado: se já houver item pending na recovery_reply_queue, pula.
// - Espaça 120s entre cada cliente, começando 30s a partir de agora.
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const json = (b: unknown, status = 200) =>
  new Response(JSON.stringify(b), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });

const RATE_LIMIT_SECONDS = 120;
const FIRST_DELAY_SECONDS = 30;

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const body = await req.json().catch(() => ({}));
    const store_id: string | undefined = body.store_id;
    const dry_run: boolean = Boolean(body.dry_run);
    const max_clients: number = Number(body.max_clients) > 0 ? Number(body.max_clients) : 500;

    if (!store_id) return json({ ok: false, error: "store_id required" });

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    // Tickets abertos da loja
    const { data: tickets, error: tErr } = await supabase
      .from("tickets")
      .select("id, store_id, customer_phone, status, ai_paused, last_message_at, recovery_message_sent_at")
      .eq("store_id", store_id)
      .eq("status", "open")
      .order("last_message_at", { ascending: true });

    if (tErr) return json({ ok: false, error: tErr.message });
    if (!tickets || tickets.length === 0) return json({ ok: true, scheduled: 0, items: [] });

    const eligible: Array<{ ticket_id: string; customer_phone: string }> = [];
    const skipped: Array<{ ticket_id: string; reason: string }> = [];
    const now = Date.now();
    const dayAgo = new Date(now - 24 * 3600 * 1000).toISOString();

    for (const t of tickets) {
      // Filtros básicos
      if (!t.customer_phone) { skipped.push({ ticket_id: t.id, reason: "no_phone" }); continue; }
      const cleaned = String(t.customer_phone).replace(/\D/g, "");
      if (!cleaned || cleaned === "0") { skipped.push({ ticket_id: t.id, reason: "invalid_phone" }); continue; }
      if (String(t.customer_phone).includes("@g.us") || String(t.customer_phone).includes("@broadcast")) {
        skipped.push({ ticket_id: t.id, reason: "group_or_broadcast" }); continue;
      }
      if (t.ai_paused) { skipped.push({ ticket_id: t.id, reason: "ai_paused" }); continue; }
      if (t.recovery_message_sent_at && new Date(t.recovery_message_sent_at).getTime() > now - 24 * 3600 * 1000) {
        skipped.push({ ticket_id: t.id, reason: "recovery_already_sent_24h" }); continue;
      }

      // Já existe item pendente?
      const { data: existing } = await supabase
        .from("recovery_reply_queue")
        .select("id")
        .eq("ticket_id", t.id)
        .in("status", ["pending", "processing"])
        .limit(1);
      if (existing && existing.length > 0) { skipped.push({ ticket_id: t.id, reason: "already_queued" }); continue; }

      // Última mensagem precisa ser inbound
      const { data: lastMsg } = await supabase
        .from("messages")
        .select("direction, created_at")
        .eq("ticket_id", t.id)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (!lastMsg) { skipped.push({ ticket_id: t.id, reason: "no_messages" }); continue; }
      if (lastMsg.direction !== "inbound") { skipped.push({ ticket_id: t.id, reason: "last_message_not_inbound" }); continue; }

      // Sem outbound CONFIRMADAMENTE ENTREGUE nas últimas 24h.
      // delivery_status = NULL, 'sent_to_zapi' ou 'failed' NÃO contam como entregue
      // (Z-API aceitou mas WhatsApp pode ter rejeitado ou ainda não confirmou).
      const { data: recentOut } = await supabase
        .from("messages")
        .select("id")
        .eq("ticket_id", t.id)
        .eq("direction", "outbound")
        .gt("created_at", dayAgo)
        .in("delivery_status", ["sent", "delivered", "received", "read"])
        .limit(1);
      if (recentOut && recentOut.length > 0) { skipped.push({ ticket_id: t.id, reason: "outbound_delivered_recent_24h" }); continue; }

      eligible.push({ ticket_id: t.id, customer_phone: cleaned });
      if (eligible.length >= max_clients) break;
    }

    console.log(`[RECOVERY ENQUEUE] store=${store_id} eligible=${eligible.length} skipped=${skipped.length} dry_run=${dry_run}`);

    if (dry_run) {
      return json({ ok: true, scheduled: 0, eligible_count: eligible.length, skipped_count: skipped.length, eligible, skipped: skipped.slice(0, 50) });
    }

    // Encontrar próximo slot livre olhando o último scheduled_for da fila desta loja
    const { data: lastQueued } = await supabase
      .from("recovery_reply_queue")
      .select("scheduled_for")
      .eq("store_id", store_id)
      .in("status", ["pending", "processing"])
      .order("scheduled_for", { ascending: false })
      .limit(1)
      .maybeSingle();

    let cursorMs = Math.max(
      now + FIRST_DELAY_SECONDS * 1000,
      lastQueued ? new Date(lastQueued.scheduled_for).getTime() + RATE_LIMIT_SECONDS * 1000 : 0,
    );

    const inserted: Array<{ ticket_id: string; scheduled_for: string }> = [];
    for (const e of eligible) {
      const scheduled_for = new Date(cursorMs).toISOString();
      const { error: insErr } = await supabase.from("recovery_reply_queue").insert({
        ticket_id: e.ticket_id,
        store_id,
        status: "pending",
        scheduled_for,
      });
      if (insErr) {
        console.error("[RECOVERY ENQUEUE] insert error", e.ticket_id, insErr.message);
        continue;
      }
      console.log(`[RECOVERY QUEUE CREATED] ${JSON.stringify({ ticket_id: e.ticket_id, store_id, scheduled_for })}`);
      inserted.push({ ticket_id: e.ticket_id, scheduled_for });
      cursorMs += RATE_LIMIT_SECONDS * 1000;
    }

    return json({
      ok: true,
      scheduled: inserted.length,
      eligible_count: eligible.length,
      skipped_count: skipped.length,
      first_at: inserted[0]?.scheduled_for ?? null,
      last_at: inserted[inserted.length - 1]?.scheduled_for ?? null,
      rate_limit_seconds: RATE_LIMIT_SECONDS,
      items: inserted,
    });
  } catch (e: any) {
    console.error("recovery-enqueue-pending error:", e);
    return json({ ok: false, error: e?.message || "Erro inesperado" });
  }
});
