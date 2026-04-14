import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

async function verifyShopifyHmac(body: string, hmacHeader: string, secret: string): Promise<boolean> {
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const signature = await crypto.subtle.sign("HMAC", key, encoder.encode(body));
  const computed = btoa(String.fromCharCode(...new Uint8Array(signature)));
  return computed === hmacHeader;
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const url = new URL(req.url);
    const storeId = url.searchParams.get("store_id");

    if (!storeId) {
      return new Response(JSON.stringify({ error: "store_id required" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const rawBody = await req.text();
    const order = JSON.parse(rawBody);

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    // Fetch settings for HMAC validation and Z-API credentials
    const { data: settings } = await supabase
      .from("settings")
      .select("shopify_client_secret, zapi_instance_id, zapi_token, zapi_client_token, notify_order_fulfilled")
      .eq("store_id", storeId)
      .single();

    if (!settings) {
      console.error("Settings not found for store:", storeId);
      return new Response(JSON.stringify({ error: "Store settings not found" }), {
        status: 404,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Verify HMAC if secret is configured
    const hmacHeader = req.headers.get("x-shopify-hmac-sha256");
    if (settings.shopify_client_secret && hmacHeader) {
      const valid = await verifyShopifyHmac(rawBody, hmacHeader, settings.shopify_client_secret);
      if (!valid) {
        console.error("HMAC validation failed for store:", storeId);
        return new Response(JSON.stringify({ error: "Invalid HMAC" }), {
          status: 401,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
    }

    // Check if automation is enabled
    if (!settings.notify_order_fulfilled) {
      console.log("Order fulfilled notification disabled for store:", storeId);
      return new Response(JSON.stringify({ skipped: "notification_disabled" }), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Extract order data
    const shopifyOrderId = String(order.id);
    const orderNumber = order.name || `#${order.order_number}`;
    const customer = order.customer || {};
    const shippingAddress = order.shipping_address || {};
    const customerName = customer.first_name || shippingAddress.first_name || "Cliente";
    const rawPhone = customer.phone || shippingAddress.phone || order.phone || "";
    const phone = rawPhone.replace(/\D/g, "");

    if (!phone) {
      console.log("No phone found for order:", orderNumber);
      return new Response(JSON.stringify({ skipped: "no_phone" }), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Extract tracking info from fulfillments
    const fulfillment = order.fulfillments?.[0] || {};
    const trackingCode = fulfillment.tracking_number || null;
    const trackingUrl = fulfillment.tracking_url || (trackingCode ? `https://www.trackingmore.com/en/track?number=${trackingCode}` : null);
    const carrier = fulfillment.tracking_company || null;

    // Build message
    let message = `Olá, ${customerName}! 😊 Seu pedido ${orderNumber} foi enviado com sucesso!`;
    if (trackingCode) {
      message += `\n\nCódigo de rastreio: ${trackingCode}`;
    }
    if (trackingUrl) {
      message += `\nAcompanhe aqui: ${trackingUrl}`;
    }
    message += `\n\nAbraços, Sophia`;

    // Insert notification (idempotency via UNIQUE constraint)
    const { data: notification, error: insertError } = await supabase
      .from("whatsapp_notifications")
      .insert({
        store_id: storeId,
        shopify_order_id: shopifyOrderId,
        order_number: orderNumber,
        customer_name: customerName,
        customer_phone: phone,
        event_type: "order_fulfilled",
        tracking_code: trackingCode,
        tracking_url: trackingUrl,
        carrier,
        message_content: message,
        status: "processing",
      })
      .select("id")
      .single();

    if (insertError) {
      // Duplicate — already processed
      if (insertError.code === "23505") {
        console.log("Duplicate notification for order:", shopifyOrderId);
        return new Response(JSON.stringify({ skipped: "duplicate" }), {
          status: 200,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      console.error("Insert error:", insertError);
      return new Response(JSON.stringify({ error: "Failed to create notification" }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const notificationId = notification.id;

    // Send via Z-API
    if (!settings.zapi_instance_id || !settings.zapi_token) {
      await supabase.from("whatsapp_notifications").update({
        status: "failed",
        error_message: "Z-API credentials not configured",
      }).eq("id", notificationId);

      return new Response(JSON.stringify({ error: "Z-API not configured" }), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const zapiUrl = `https://api.z-api.io/instances/${settings.zapi_instance_id}/token/${settings.zapi_token}/send-text`;
    const zapiRes = await fetch(zapiUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Client-Token": settings.zapi_client_token || "",
      },
      body: JSON.stringify({ phone, message }),
    });

    if (!zapiRes.ok) {
      const errText = await zapiRes.text();
      console.error("Z-API send failed:", errText);
      await supabase.from("whatsapp_notifications").update({
        status: "failed",
        error_message: `Z-API error: ${errText.substring(0, 500)}`,
      }).eq("id", notificationId);

      return new Response(JSON.stringify({ error: "Failed to send WhatsApp" }), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Success
    await supabase.from("whatsapp_notifications").update({
      status: "sent",
      sent_at: new Date().toISOString(),
    }).eq("id", notificationId);

    console.log(`Notification sent for order ${orderNumber} to ${phone}`);
    return new Response(JSON.stringify({ ok: true, notification_id: notificationId }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("process-shopify-webhook error:", e);
    return new Response(JSON.stringify({ error: e.message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
