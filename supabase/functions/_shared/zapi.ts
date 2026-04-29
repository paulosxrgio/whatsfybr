export type ZapiSendOrigin = "manual" | "ai_scheduler" | "ai_handoff" | "supervisor_alert";

type SendZapiTextParams = {
  instanceId: string;
  token: string;
  clientToken?: string | null;
  phone: string;
  recipientLid?: string | null;
  message: string;
  origin: ZapiSendOrigin;
};

export type ZapiSendResult = {
  ok: boolean;
  error?: string;
  status?: number;
  zapi_message_id?: string | null;
  zapi_zaap_id?: string | null;
  zapi_id?: string | null;
  zaapId?: string | null;
  messageId?: string | null;
  zapi_response?: Record<string, unknown>;
};

const parseJson = (text: string) => {
  try {
    return JSON.parse(text || "{}");
  } catch {
    return { raw: text };
  }
};

export async function getZapiInstanceStatus(instanceId: string, token: string, clientToken?: string | null) {
  const res = await fetch(`https://api.z-api.io/instances/${instanceId}/token/${token}/status`, {
    method: "GET",
    headers: {
      "Content-Type": "application/json",
      ...(clientToken ? { "Client-Token": clientToken } : {}),
    },
  });
  const body = parseJson(await res.text());
  const connected = body?.connected;
  const smartphoneConnected = body?.smartphoneConnected;
  console.log("[ZAPI INSTANCE STATUS]", JSON.stringify({ connected, smartphoneConnected }));
  return { ok: res.ok, connected, smartphoneConnected, body };
}

export async function sendZapiText(params: SendZapiTextParams): Promise<ZapiSendResult> {
  const { instanceId, token, clientToken, phone, recipientLid, message, origin } = params;
  const recipient = recipientLid?.includes("@lid") ? recipientLid : phone;
  console.log("[SEND DEBUG]", JSON.stringify({ origin, phone, recipient, usingLid: recipient !== phone, messageLength: message.length, hasClientToken: Boolean(clientToken) }));

  const status = await getZapiInstanceStatus(instanceId, token, clientToken);
  if (!status.ok || status.connected === false || status.smartphoneConnected === false) {
    return { ok: false, error: "Z-API desconectada", zapi_response: status.body };
  }

  const payload = { phone: recipient, message };
  console.log("[ZAPI SEND PAYLOAD]", JSON.stringify({ origin, phone: recipient, originalPhone: phone, usingLid: recipient !== phone, messageLength: message.length }));

  const res = await fetch(`https://api.z-api.io/instances/${instanceId}/token/${token}/send-text`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(clientToken ? { "Client-Token": clientToken } : {}),
    },
    body: JSON.stringify(payload),
  });

  const rawText = await res.text();
  const body = parseJson(rawText);
  console.log("[Z-API RAW RESPONSE]", JSON.stringify({ origin, status: res.status, body }));

  if (!res.ok || body?.error) {
    return { ok: false, status: res.status, error: body?.error || `Z-API retornou HTTP ${res.status}`, zapi_response: body };
  }

  const messageId = body?.messageId || null;
  const zaapId = body?.zaapId || null;
  const zapiId = body?.id || null;
  const primaryId = messageId || zapiId || zaapId || null;

  if (!primaryId) {
    return { ok: false, status: res.status, error: "Z-API respondeu sem ID da mensagem", zapi_response: body };
  }

  return {
    ok: true,
    status: res.status,
    zapi_message_id: primaryId,
    zapi_zaap_id: zaapId,
    zapi_id: zapiId,
    zaapId,
    messageId,
    zapi_response: body,
  };
}