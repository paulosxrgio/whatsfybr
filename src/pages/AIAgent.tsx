import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useStore } from "@/contexts/StoreContext";
import { useAuth } from "@/contexts/AuthContext";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { Bot, Save, TrendingUp, ExternalLink } from "lucide-react";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import { useNavigate } from "react-router-dom";

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
  const { user } = useAuth();
  const navigate = useNavigate();
  const [settingsId, setSettingsId] = useState<string | null>(null);
  const [aiIsActive, setAiIsActive] = useState(false);
  const [aiDelay, setAiDelay] = useState(2);
  const [aiPrompt, setAiPrompt] = useState("");
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(true);
  const [accountProvider, setAccountProvider] = useState<string | null>(null);
  const [accountModel, setAccountModel] = useState<string | null>(null);

  useEffect(() => {
    if (!currentStore || !user) return;
    setLoading(true);

    Promise.all([
      supabase
        .from("settings")
        .select("id, ai_is_active, ai_response_delay, ai_system_prompt")
        .eq("store_id", currentStore.id)
        .maybeSingle(),
      supabase
        .from("account_settings")
        .select("ai_provider, ai_model")
        .eq("user_id", user.id)
        .maybeSingle(),
    ]).then(([settingsRes, accountRes]) => {
      const data = settingsRes.data;
      if (data) {
        setSettingsId(data.id);
        setAiIsActive(data.ai_is_active ?? false);
        setAiDelay(data.ai_response_delay ?? 2);
        setAiPrompt(data.ai_system_prompt || getDefaultPrompt(currentStore.name));
      } else {
        setSettingsId(null);
        setAiPrompt(getDefaultPrompt(currentStore.name));
      }

      const acct = accountRes.data;
      setAccountProvider(acct?.ai_provider || null);
      setAccountModel(acct?.ai_model || null);

      setLoading(false);
    });
  }, [currentStore, user]);

  const handleSave = async () => {
    if (!currentStore) return;
    setSaving(true);
    const payload = {
      store_id: currentStore.id,
      ai_is_active: aiIsActive,
      ai_response_delay: aiDelay,
      ai_system_prompt: aiPrompt,
    };

    let error;
    if (settingsId) {
      ({ error } = await supabase.from("settings").update(payload).eq("id", settingsId));
    } else {
      const res = await supabase.from("settings").insert(payload).select("id").single();
      error = res.error;
      if (res.data) setSettingsId(res.data.id);
    }

    if (error) toast.error("Erro ao salvar configurações");
    else toast.success("Configurações salvas!");
    setSaving(false);
  };

  if (loading) {
    return <div className="p-6 flex items-center justify-center h-full text-muted-foreground">Carregando...</div>;
  }

  return (
    <div className="p-6 max-w-3xl mx-auto space-y-6 overflow-auto h-full">
      <h1 className="text-2xl font-bold flex items-center gap-2">
        <Bot className="h-6 w-6 text-primary" /> Agente IA — Sophia
      </h1>

      <Card>
        <CardHeader>
          <CardTitle>Provedor de IA</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex items-center justify-between">
            <div className="text-sm text-muted-foreground">
              {accountProvider && accountModel
                ? `Provedor configurado em Minha Conta: ${accountProvider === "openai" ? "OpenAI" : "Anthropic"} — ${accountModel}`
                : "Nenhum provedor configurado. Configure em Minha Conta."}
            </div>
            <Button variant="outline" size="sm" onClick={() => navigate("/account-settings")} className="gap-1">
              <ExternalLink className="h-3 w-3" /> Alterar em Minha Conta
            </Button>
          </div>
        </CardContent>
      </Card>

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
