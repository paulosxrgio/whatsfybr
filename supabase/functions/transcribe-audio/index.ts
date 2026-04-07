import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const { ticket_id, store_id, audio_url } = await req.json();

    if (!ticket_id || !store_id || !audio_url) {
      return new Response(JSON.stringify({ error: "ticket_id, store_id, audio_url required" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    // Get settings for OpenAI key
    const { data: settings } = await supabase.from("settings").select("openai_api_key").eq("store_id", store_id).single();
    if (!settings?.openai_api_key) {
      return new Response(JSON.stringify({ error: "OpenAI API key not configured" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Download audio
    const audioRes = await fetch(audio_url);
    if (!audioRes.ok) throw new Error("Failed to download audio");
    const audioBlob = await audioRes.blob();

    // Send to Whisper
    const formData = new FormData();
    formData.append("file", audioBlob, "audio.ogg");
    formData.append("model", "whisper-1");
    formData.append("language", "pt");

    const whisperRes = await fetch("https://api.openai.com/v1/audio/transcriptions", {
      method: "POST",
      headers: { "Authorization": `Bearer ${settings.openai_api_key}` },
      body: formData,
    });

    if (!whisperRes.ok) {
      const errText = await whisperRes.text();
      console.error("Whisper error:", errText);
      throw new Error("Whisper transcription failed");
    }

    const { text } = await whisperRes.json();

    // Update the most recent audio message for this ticket
    const { data: audioMsg } = await supabase
      .from("messages")
      .select("id")
      .eq("ticket_id", ticket_id)
      .eq("message_type", "audio")
      .eq("direction", "inbound")
      .order("created_at", { ascending: false })
      .limit(1)
      .single();

    if (audioMsg) {
      await supabase.from("messages").update({ content: `[Áudio transcrito]: ${text}` }).eq("id", audioMsg.id);
    }

    return new Response(JSON.stringify({ ok: true, transcription: text }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("transcribe-audio error:", e);
    return new Response(JSON.stringify({ error: e.message }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
