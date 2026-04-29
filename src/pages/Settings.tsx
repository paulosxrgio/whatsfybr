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
import { Copy, CheckCircle, Loader2, Info, Wifi, Activity, Zap, ShoppingBag, Eye, EyeOff, RefreshCw } from "lucide-react";

const PasswordInput = ({ value, onChange, placeholder, className }: { value: string; onChange: (e: React.ChangeEvent<HTMLInputElement>) => void; placeholder?: string; className?: string }) => {
  const [show, setShow] = useState(false);
  return (
    <div className="relative">
      <Input value={value} onChange={onChange} type={show ? "text" : "password"} placeholder={placeholder} className={className} />
      <Button type="button" variant="ghost" size="icon" className="absolute right-0 top-0 h-full px-3 hover:bg-transparent" onClick={() => setShow(!show)}>
        {show ? <EyeOff className="h-4 w-4 text-muted-foreground" /> : <Eye className="h-4 w-4 text-muted-foreground" />}
      </Button>
    </div>
  );
};

const DEFAULT_SYSTEM_PROMPT = `Você é Sophia, atendente de suporte da loja via WhatsApp.

IDIOMA: Sempre responda em português brasileiro.

TOM: Simpático, humano, caloroso e direto. Como uma atendente real de WhatsApp, não um robô. Use linguagem natural, pode usar emojis com moderação (1 por mensagem no máximo).

FORMATO:
- Mensagens curtas. WhatsApp não é email.
- Máximo 3 parágrafos curtos por resposta.
- Nunca use listas com bullet points.
- Nunca use Markdown.
- Para agradecimentos simples, responda com 1 linha apenas.

RASTREAMENTO: Use SEMPRE o link da própria loja (NUNCA trackingmore):
https://adorisse.com.br/apps/parcelpanel?nums=CODIGO

SPAM E GOLPES: Se identificar sinais de golpe, responda apenas:
"Oi! Este canal é exclusivo para suporte de pedidos. Abraços, Sophia"

REEMBOLSO E CANCELAMENTO:
1ª menção: seja empática, acolhedora; ofereça alternativa (rastreio, troca, benefícios). Use tom: "Fico muito triste em saber que você está pensando em cancelar 😢 Me conta o que aconteceu? Quero resolver pra você!"
2ª menção/insistência: aceite com simpatia, sem resistência. Encaminhe para https://reembolso.adorisse.com/ com carinho e deseje um bom dia/tarde/noite.
NUNCA seja fria, burocrática ou diga "não podemos". SEMPRE valide o sentimento antes de responder.

IMAGENS E MÍDIAS:
- Quando ver [Imagem: descrição] no histórico, use essa descrição para responder — você JÁ viu a imagem.
- Comprovante de pagamento → confirme recebimento e verifique no pedido.
- Print de anúncio/produto → identifique se é da Adorisse pelo domínio adorisse.com.br.
- Foto de produto recebido com problema → registre como solicitação de troca.
- NUNCA diga que não consegue ver imagens — agora você consegue.

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
  notify_order_fulfilled: boolean;
};

const SettingsPage = () => {
  const { currentStore } = useStore();
  const [settings, setSettings] = useState<Settings | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [verifying, setVerifying] = useState(false);
  const [verifyingShopify, setVerifyingShopify] = useState(false);

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
          notify_order_fulfilled: false,
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

  const shopifyWebhookUrl = currentStore
    ? `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/process-shopify-webhook?store_id=${currentStore.id}`
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
            <PasswordInput value={settings.zapi_token} onChange={(e) => update("zapi_token", e.target.value)} />
          </div>
          <div className="space-y-2">
            <Label>Client Token</Label>
            <PasswordInput value={settings.zapi_client_token} onChange={(e) => update("zapi_client_token", e.target.value)} />
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

      {/* Diagnóstico do Webhook */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Activity className="h-5 w-5" />
            Diagnóstico do Webhook
          </CardTitle>
          <CardDescription>Verifique se a integração Z-API está funcionando</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="p-3 bg-yellow-50 border border-yellow-200 rounded-lg text-sm">
            <p className="font-medium text-yellow-800 mb-1">⚠️ URL que deve estar configurada na Z-API:</p>
            <code className="text-xs bg-white px-2 py-1 rounded border block break-all">
              {webhookUrl}
            </code>
            <p className="text-yellow-700 mt-2 text-xs">
              Cole essa URL exata no campo "Ao receber" da sua instância Z-API e clique em Salvar.
            </p>
          </div>

          <Button
            variant="outline"
            onClick={handleVerifyZapi}
            disabled={verifying || !settings.zapi_instance_id || !settings.zapi_token}
            className="w-full"
          >
            {verifying ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <Wifi className="h-4 w-4 mr-2" />}
            Testar Webhook Z-API
          </Button>
        </CardContent>
      </Card>
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
            <PasswordInput value={settings.shopify_client_id} onChange={(e) => update("shopify_client_id", e.target.value)} />
          </div>
          <div className="space-y-2">
            <Label>Client Secret</Label>
            <PasswordInput value={settings.shopify_client_secret} onChange={(e) => update("shopify_client_secret", e.target.value)} placeholder="shpss_... ou shpat_..." />
            <p className="text-xs text-muted-foreground">Client Secret (shpss_...) ou Admin API Access Token (shpat_...)</p>
          </div>

          <Button
            variant="outline"
            onClick={async () => {
              if (!settings.shopify_store_url || !settings.shopify_client_secret) {
                toast.error("Preencha a URL da loja e o Access Token primeiro.");
                return;
              }
              setVerifyingShopify(true);
              try {
                const { data, error } = await supabase.functions.invoke("verify-shopify-connection", {
                  body: {
                    store_url: settings.shopify_store_url,
                    client_id: settings.shopify_client_id,
                    client_secret: settings.shopify_client_secret,
                    access_token: settings.shopify_client_secret,
                  },
                });
                if (error) throw error;
                if (data?.success) {
                  toast.success(data.message);
                } else {
                  toast.error(data?.error || "Falha na verificação.");
                }
              } catch {
                toast.error("Erro ao verificar conexão Shopify.");
              }
              setVerifyingShopify(false);
            }}
            disabled={verifyingShopify}
            className="w-full"
          >
            {verifyingShopify ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <ShoppingBag className="h-4 w-4 mr-2" />}
            Verificar Conexão Shopify
          </Button>
        </CardContent>
      </Card>

      {/* Automações */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Zap className="h-5 w-5" />
            Automações
          </CardTitle>
          <CardDescription>Mensagens automáticas via WhatsApp</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <Label>Pedido Enviado</Label>
              <p className="text-xs text-muted-foreground">Envia mensagem automática quando um pedido é marcado como enviado na Shopify</p>
            </div>
            <Switch checked={settings.notify_order_fulfilled} onCheckedChange={(v) => update("notify_order_fulfilled", v)} />
          </div>

          {settings.notify_order_fulfilled && (
            <>
              <div className="space-y-2">
                <Label>URL do Webhook Shopify (copie para a Shopify)</Label>
                <div className="flex gap-2">
                  <Input value={shopifyWebhookUrl} readOnly className="text-xs" />
                  <Button variant="outline" size="icon" onClick={() => { navigator.clipboard.writeText(shopifyWebhookUrl); toast.success("URL copiada!"); }}>
                    <Copy className="h-4 w-4" />
                  </Button>
                </div>
              </div>

              <div className="rounded-lg border bg-muted/50 p-4 space-y-2">
                <div className="flex items-center gap-2 text-sm font-medium">
                  <Info className="h-4 w-4 text-primary" />
                  Como configurar na Shopify
                </div>
                <ol className="text-xs text-muted-foreground space-y-1 list-decimal list-inside">
                  <li>Acesse o painel da Shopify → Configurações → Notificações</li>
                  <li>Vá em Webhooks e clique em "Criar webhook"</li>
                  <li>Evento: <strong>Fulfillment creation</strong> (ou "Order fulfillment")</li>
                  <li>Formato: <strong>JSON</strong></li>
                  <li>Cole a URL acima no campo de URL</li>
                  <li>Clique em Salvar</li>
                </ol>
              </div>
            </>
          )}
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
