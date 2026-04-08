import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useStore } from "@/contexts/StoreContext";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "sonner";
import { Copy, CheckCircle, Loader2, Info, Wifi } from "lucide-react";

const DEFAULT_SYSTEM_PROMPT = `Você é Sophia, atendente de suporte da loja via WhatsApp.

IDIOMA: Sempre responda em português brasileiro.

TOM: Simpático, humano, caloroso e direto. Como uma atendente real de WhatsApp, não um robô. Use linguagem natural, pode usar emojis com moderação (1 por mensagem no máximo).

FORMATO:
- Mensagens curtas. WhatsApp não é email.
- Máximo 3 parágrafos curtos por resposta.
- Nunca use listas com bullet points.
- Nunca use Markdown.
- Para agradecimentos simples, responda com 1 linha apenas.

RASTREAMENTO: Use sempre o TrackingMore:
https://www.trackingmore.com/en/track?number=CODIGO

SPAM E GOLPES: Se identificar sinais de golpe, responda apenas:
"Oi! Este canal é exclusivo para suporte de pedidos. Abraços, Sophia"

REEMBOLSO: Após 2 pedidos, pare de persuadir e diga que registrou e a equipe entrará em contato.

Assine sempre: Abraços, Sophia`;

type Settings = {
  id?: string;
  store_id: string;
  zapi_instance_id: string;
  zapi_token: string;
  zapi_client_token: string;
  ai_system_prompt: string;
  ai_is_active: boolean;
  ai_response_delay: number;
  shopify_store_url: string;
  shopify_client_id: string;
  shopify_client_secret: string;
};

const SettingsPage = () => {
  const { currentStore } = useStore();
  const [settings, setSettings] = useState<Settings | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [verifying, setVerifying] = useState(false);

  useEffect(() => {
    if (!currentStore) return;
    const fetch = async () => {
      setLoading(true);
      const { data } = await supabase
        .from("settings")
        .select("*")
        .eq("store_id", currentStore.id)
        .maybeSingle();

      if (data) {
        setSettings(data as any);
      } else {
        setSettings({
          store_id: currentStore.id,
          zapi_instance_id: "",
          zapi_token: "",
          zapi_client_token: "",
          ai_system_prompt: DEFAULT_SYSTEM_PROMPT,
          ai_is_active: true,
          ai_response_delay: 2,
          shopify_store_url: "",
          shopify_client_id: "",
          shopify_client_secret: "",
        });
      }
      setLoading(false);
    };
    fetch();
  }, [currentStore]);

  const handleSave = async () => {
    if (!settings || !currentStore) return;
    setSaving(true);
    const payload = { ...settings, store_id: currentStore.id };
    delete (payload as any).id;
    delete (payload as any).created_at;

    const { error } = settings.id
      ? await supabase.from("settings").update(payload).eq("id", settings.id)
      : await supabase.from("settings").insert(payload);

    if (error) toast.error("Erro ao salvar configurações");
    else toast.success("Configurações salvas!");
    setSaving(false);
  };

  const handleVerifyZapi = async () => {
    if (!settings) return;
    if (!settings.zapi_instance_id || !settings.zapi_token) {
      toast.error("Preencha o Instance ID e o Token primeiro.");
      return;
    }
    setVerifying(true);
    try {
      const { data, error } = await supabase.functions.invoke("verify-zapi-connection", {
        body: {
          instance_id: settings.zapi_instance_id,
          token: settings.zapi_token,
          client_token: settings.zapi_client_token,
        },
      });
      if (error) throw error;
      if (data?.success) {
        toast.success(data.message);
      } else {
        toast.error(data?.error || "Falha na verificação.");
      }
    } catch {
      toast.error("Erro ao verificar conexão Z-API.");
    }
    setVerifying(false);
  };

  const webhookUrl = currentStore
    ? `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/process-inbound-whatsapp?store_id=${currentStore.id}`
    : "";

  if (loading || !settings) {
    return <div className="flex items-center justify-center h-full"><Loader2 className="h-6 w-6 animate-spin" /></div>;
  }

  const update = (key: keyof Settings, value: any) => setSettings({ ...settings, [key]: value });

  return (
    <div className="p-6 max-w-3xl mx-auto space-y-6 overflow-auto h-full">
      <h1 className="text-2xl font-bold">Configurações</h1>

      {/* Z-API */}
      <Card>
        <CardHeader>
          <CardTitle>Z-API (WhatsApp)</CardTitle>
          <CardDescription>Credenciais da sua instância Z-API</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label>Instance ID</Label>
            <Input value={settings.zapi_instance_id} onChange={(e) => update("zapi_instance_id", e.target.value)} />
          </div>
          <div className="space-y-2">
            <Label>Token</Label>
            <Input value={settings.zapi_token} onChange={(e) => update("zapi_token", e.target.value)} type="password" />
          </div>
          <div className="space-y-2">
            <Label>Client Token</Label>
            <Input value={settings.zapi_client_token} onChange={(e) => update("zapi_client_token", e.target.value)} type="password" />
          </div>
          <div className="space-y-2">
            <Label>URL do Webhook (copie para a Z-API)</Label>
            <div className="flex gap-2">
              <Input value={webhookUrl} readOnly className="text-xs" />
              <Button variant="outline" size="icon" onClick={() => { navigator.clipboard.writeText(webhookUrl); toast.success("URL copiada!"); }}>
                <Copy className="h-4 w-4" />
              </Button>
            </div>
          </div>

          {/* Webhook Instructions */}
          <div className="rounded-lg border bg-muted/50 p-4 space-y-2">
            <div className="flex items-center gap-2 text-sm font-medium">
              <Info className="h-4 w-4 text-primary" />
              Como configurar o Webhook
            </div>
            <ol className="text-xs text-muted-foreground space-y-1 list-decimal list-inside">
              <li>Acesse o painel da Z-API</li>
              <li>Vá em sua instância → Webhooks</li>
              <li>Em "Ao receber mensagem", cole a URL acima</li>
              <li>Clique em Salvar</li>
              <li>Volte aqui e clique em <strong>Verificar Conexão</strong></li>
            </ol>
          </div>

          <Button variant="outline" onClick={handleVerifyZapi} disabled={verifying} className="w-full">
            {verifying ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <Wifi className="h-4 w-4 mr-2" />}
            Verificar Conexão
          </Button>
        </CardContent>
      </Card>

      {/* AI Provider */}
      <Card>
        <CardHeader>
          <CardTitle>Provedor de IA</CardTitle>
          <CardDescription>Configure o provedor e modelo da IA</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label>Provedor</Label>
            <Select value={settings.ai_provider} onValueChange={(v) => update("ai_provider", v)}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="openai">OpenAI</SelectItem>
                <SelectItem value="anthropic">Anthropic</SelectItem>
              </SelectContent>
            </Select>
          </div>
          {settings.ai_provider === "openai" && (
            <div className="space-y-2">
              <Label>OpenAI API Key</Label>
              <Input value={settings.openai_api_key} onChange={(e) => update("openai_api_key", e.target.value)} type="password" />
            </div>
          )}
          {settings.ai_provider === "anthropic" && (
            <div className="space-y-2">
              <Label>Anthropic API Key</Label>
              <Input value={settings.anthropic_api_key} onChange={(e) => update("anthropic_api_key", e.target.value)} type="password" />
            </div>
          )}
          <div className="space-y-2">
            <Label>Modelo</Label>
            <Input value={settings.ai_model} onChange={(e) => update("ai_model", e.target.value)} placeholder="gpt-4o" />
          </div>
        </CardContent>
      </Card>

      {/* AI Agent */}
      <Card>
        <CardHeader>
          <CardTitle>Agente IA (Sophia)</CardTitle>
          <CardDescription>Configure o comportamento do agente</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center justify-between">
            <Label>IA Ativa</Label>
            <Switch checked={settings.ai_is_active} onCheckedChange={(v) => update("ai_is_active", v)} />
          </div>
          <div className="space-y-2">
            <Label>Delay de resposta (segundos)</Label>
            <Input type="number" value={settings.ai_response_delay} onChange={(e) => update("ai_response_delay", parseInt(e.target.value) || 0)} min={0} max={60} />
          </div>
          <div className="space-y-2">
            <Label>System Prompt</Label>
            <Textarea
              value={settings.ai_system_prompt}
              onChange={(e) => update("ai_system_prompt", e.target.value)}
              rows={12}
              className="text-xs font-mono"
            />
          </div>
        </CardContent>
      </Card>

      {/* Shopify */}
      <Card>
        <CardHeader>
          <CardTitle>Shopify</CardTitle>
          <CardDescription>Integração com sua loja Shopify</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label>URL da Loja</Label>
            <Input value={settings.shopify_store_url} onChange={(e) => update("shopify_store_url", e.target.value)} placeholder="minha-loja.myshopify.com" />
          </div>
          <div className="space-y-2">
            <Label>Client ID</Label>
            <Input value={settings.shopify_client_id} onChange={(e) => update("shopify_client_id", e.target.value)} type="password" />
          </div>
          <div className="space-y-2">
            <Label>Client Secret</Label>
            <Input value={settings.shopify_client_secret} onChange={(e) => update("shopify_client_secret", e.target.value)} type="password" />
          </div>
        </CardContent>
      </Card>

      <Button onClick={handleSave} disabled={saving} className="w-full">
        {saving ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <CheckCircle className="h-4 w-4 mr-2" />}
        Salvar Configurações
      </Button>
    </div>
  );
};

export default SettingsPage;
