import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useStore } from "@/contexts/StoreContext";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { Bot, Save, TrendingUp } from "lucide-react";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "sonner";

const modelsByProvider: Record<string, { value: string; label: string }[]> = {
  openai: [
    { value: "gpt-4o", label: "GPT-4o" },
    { value: "gpt-4o-mini", label: "GPT-4o Mini" },
    { value: "gpt-3.5-turbo", label: "GPT-3.5 Turbo" },
  ],
  anthropic: [
    { value: "claude-sonnet-4-20250514", label: "Claude Sonnet 4" },
    { value: "claude-3-haiku-20240307", label: "Claude 3 Haiku" },
  ],
};

const getDefaultPrompt = (storeName: string) =>
  `Você é Sophia, atendente de suporte da loja ${storeName} via WhatsApp.

IDIOMA: Sempre responda em português brasileiro.

TOM: Simpático, humano, caloroso e direto. Como uma atendente real de WhatsApp, não um robô. Use linguagem natural, pode usar emojis com moderação (1 por mensagem no máximo).

FORMATO:
- Mensagens curtas. WhatsApp não é email.
- Máximo 3 parágrafos curtos por resposta.
- Nunca use listas com bullet points.
- Nunca use Markdown.
- Para agradecimentos simples, responda com 1 linha apenas.

NOME DO PRODUTO: Pode e deve mencionar o nome do produto junto com o número do pedido.

RASTREAMENTO: Use sempre o TrackingMore:
https://www.trackingmore.com/en/track?number=CODIGO

SPAM E GOLPES: Se identificar sinais de golpe (parceiro Shopify, pedido de acesso, pagamento), responda apenas:
"Oi! Este canal é exclusivo para suporte de pedidos. Abraços, Sophia"

REEMBOLSO: Após 2 pedidos, pare de persuadir e diga que registrou e a equipe entrará em contato.

Assine sempre: Abraços, Sophia`;

const AIAgentPage = () => {
  const { currentStore } = useStore();
  const [settingsId, setSettingsId] = useState<string | null>(null);
  const [aiIsActive, setAiIsActive] = useState(false);
  const [aiProvider, setAiProvider] = useState("openai");
  const [aiModel, setAiModel] = useState("gpt-4o");
  const [aiDelay, setAiDelay] = useState(2);
  const [aiPrompt, setAiPrompt] = useState("");
  const [openaiKey, setOpenaiKey] = useState("");
  const [anthropicKey, setAnthropicKey] = useState("");
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!currentStore) return;
    setLoading(true);
    supabase
      .from("settings")
      .select("id, ai_is_active, ai_provider, ai_model, ai_response_delay, ai_system_prompt, openai_api_key, anthropic_api_key")
      .eq("store_id", currentStore.id)
      .maybeSingle()
      .then(({ data }) => {
        if (data) {
          setSettingsId(data.id);
          setAiIsActive(data.ai_is_active ?? false);
          setAiProvider(data.ai_provider || "openai");
          setAiModel(data.ai_model || "gpt-4o");
          setAiDelay(data.ai_response_delay ?? 2);
          setAiPrompt(data.ai_system_prompt || getDefaultPrompt(currentStore.name));
          setOpenaiKey(data.openai_api_key || "");
          setAnthropicKey(data.anthropic_api_key || "");
        } else {
          setSettingsId(null);
          setAiPrompt(getDefaultPrompt(currentStore.name));
        }
        setLoading(false);
      });
  }, [currentStore]);

  useEffect(() => {
    const models = modelsByProvider[aiProvider] || modelsByProvider.openai;
    if (!models.find((m) => m.value === aiModel)) {
      setAiModel(models[0].value);
    }
  }, [aiProvider]);

  const handleSave = async () => {
    if (!currentStore) return;
    setSaving(true);
    const payload = {
      store_id: currentStore.id,
      ai_is_active: aiIsActive,
      ai_provider: aiProvider,
      ai_model: aiModel,
      ai_response_delay: aiDelay,
      ai_system_prompt: aiPrompt,
      openai_api_key: openaiKey || null,
      anthropic_api_key: anthropicKey || null,
    };

    let error;
    if (settingsId) {
      ({ error } = await supabase.from("settings").update(payload).eq("id", settingsId));
    } else {
      const res = await supabase.from("settings").insert(payload).select("id").single();
      error = res.error;
      if (res.data) setSettingsId(res.data.id);
    }

    if (error) {
      toast.error("Erro ao salvar configurações");
    } else {
      toast.success("Configurações salvas!");
    }
    setSaving(false);
  };

  if (loading) {
    return <div className="p-6 flex items-center justify-center h-full text-muted-foreground">Carregando...</div>;
  }

  const models = modelsByProvider[aiProvider] || modelsByProvider.openai;

  return (
    <div className="p-6 max-w-3xl mx-auto space-y-6 overflow-auto h-full">
      <h1 className="text-2xl font-bold flex items-center gap-2">
        <Bot className="h-6 w-6 text-primary" /> Agente IA — Sophia
      </h1>

      <Card>
        <CardHeader>
          <CardTitle>Controle</CardTitle>
        </CardHeader>
        <CardContent className="flex items-center justify-between">
          <Label>Ativar respostas automáticas</Label>
          <Switch checked={aiIsActive} onCheckedChange={setAiIsActive} />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Provedor e Modelo</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-4 md:grid-cols-2">
            <div className="space-y-2">
              <Label>Provedor</Label>
              <Select value={aiProvider} onValueChange={setAiProvider}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="openai">OpenAI</SelectItem>
                  <SelectItem value="anthropic">Anthropic</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Modelo</Label>
              <Select value={aiModel} onValueChange={setAiModel}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {models.map((m) => (
                    <SelectItem key={m.value} value={m.value}>{m.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="space-y-2">
            <Label>Chave API {aiProvider === "openai" ? "OpenAI" : "Anthropic"}</Label>
            <Input
              type="password"
              placeholder={`sk-...`}
              value={aiProvider === "openai" ? openaiKey : anthropicKey}
              onChange={(e) =>
                aiProvider === "openai" ? setOpenaiKey(e.target.value) : setAnthropicKey(e.target.value)
              }
            />
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Delay de Resposta</CardTitle>
          <CardDescription>Tempo em segundos antes de enviar a resposta (simula digitação)</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex items-center gap-3">
            <Input
              type="number"
              min={0}
              max={30}
              value={aiDelay}
              onChange={(e) => setAiDelay(Number(e.target.value))}
              className="w-24"
            />
            <span className="text-sm text-muted-foreground">segundos</span>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>System Prompt</CardTitle>
          <CardDescription>Prompt usado pela Sophia para gerar respostas</CardDescription>
        </CardHeader>
        <CardContent>
          <Textarea
            value={aiPrompt}
            onChange={(e) => setAiPrompt(e.target.value)}
            rows={18}
            className="text-xs font-mono"
          />
        </CardContent>
      </Card>

      <Button onClick={handleSave} disabled={saving} className="w-full gap-2">
        <Save className="h-4 w-4" /> {saving ? "Salvando..." : "Salvar configurações"}
      </Button>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2"><TrendingUp className="h-5 w-5" /> Sugestões de Melhoria</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">As sugestões serão geradas com base nas interações da Sophia com os clientes.</p>
        </CardContent>
      </Card>
    </div>
  );
};

export default AIAgentPage;
