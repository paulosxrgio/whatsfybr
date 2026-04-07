import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const { ticket_id, message, store_id } = await req.json();

    if (!ticket_id || !message || !store_id) {
      return new Response(JSON.stringify({ error: "ticket_id, message, store_id required" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    // Get ticket
    const { data: ticket } = await supabase.from("tickets").select("customer_phone").eq("id", ticket_id).single();
    if (!ticket) throw new Error("Ticket not found");

    // Get settings
    const { data: settings } = await supabase.from("settings").select("*").eq("store_id", store_id).single();
    if (!settings) throw new Error("Settings not found");

    // Send via Z-API
    const zapiUrl = `https://api.z-api.io/instances/${settings.zapi_instance_id}/token/${settings.zapi_token}/send-text`;
    const zapiRes = await fetch(zapiUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Client-Token": settings.zapi_client_token || "",
      },
      body: JSON.stringify({ phone: ticket.customer_phone, message }),
    });

    if (!zapiRes.ok) {
      const errText = await zapiRes.text();
      console.error("Z-API error:", errText);
      throw new Error("Z-API send failed");
    }

    // Save outbound message
    await supabase.from("messages").insert({
      ticket_id,
      store_id,
      content: message,
      direction: "outbound",
      message_type: "text",
    });

    // Update last_message_at
    await supabase.from("tickets").update({ last_message_at: new Date().toISOString() }).eq("id", ticket_id);

    return new Response(JSON.stringify({ ok: true }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("send-whatsapp-reply error:", e);
    return new Response(JSON.stringify({ error: e.message }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
