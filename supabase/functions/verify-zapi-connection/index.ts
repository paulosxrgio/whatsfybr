import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const { instance_id, token, client_token } = await req.json();

    if (!instance_id || !token) {
      return new Response(
        JSON.stringify({ success: false, error: "Instance ID e Token são obrigatórios." }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const res = await fetch(
      `https://api.z-api.io/instances/${instance_id}/token/${token}/status`,
      {
        method: "GET",
        headers: {
          "Client-Token": client_token || "",
          "Content-Type": "application/json",
        },
      }
    );

    const data = await res.json();

    if (res.ok && data.connected) {
      return new Response(
        JSON.stringify({ success: true, message: "Z-API conectada com sucesso! ✅" }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    return new Response(
      JSON.stringify({ success: false, error: "Instância não conectada. Verifique o QR Code no painel da Z-API." }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (e) {
    console.error("verify-zapi error:", e);
    return new Response(
      JSON.stringify({ success: false, error: "Erro ao conectar com Z-API. Verifique suas credenciais." }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
