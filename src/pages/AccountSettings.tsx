import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "sonner";
import { Loader2, Save, SlidersHorizontal, User, Plug, CheckCircle2, XCircle } from "lucide-react";

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

const AccountSettingsPage = () => {
  const { user } = useAuth();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [aiProvider, setAiProvider] = useState("openai");
  const [aiModel, setAiModel] = useState("gpt-4o");
  const [openaiKey, setOpenaiKey] = useState("");
  const [anthropicKey, setAnthropicKey] = useState("");
  const [settingsId, setSettingsId] = useState<string | null>(null);
  const [verifying, setVerifying] = useState(false);
  const [verifyStatus, setVerifyStatus] = useState<'idle' | 'success' | 'error'>('idle');

  useEffect(() => {
    if (!user) return;
    setLoading(true);
    supabase
      .from("account_settings")
      .select("*")
      .eq("user_id", user.id)
      .maybeSingle()
      .then(({ data }) => {
        if (data) {
          setSettingsId(data.id);
          setAiProvider(data.ai_provider || "openai");
          setAiModel(data.ai_model || "gpt-4o");
          setOpenaiKey(data.openai_api_key || "");
          setAnthropicKey(data.anthropic_api_key || "");
        }
        setLoading(false);
      });
  }, [user]);

  useEffect(() => {
    const models = modelsByProvider[aiProvider] || modelsByProvider.openai;
    if (!models.find((m) => m.value === aiModel)) {
      setAiModel(models[0].value);
    }
  }, [aiProvider]);

  const handleSave = async () => {
    if (!user) return;
    setSaving(true);
    const payload = {
      user_id: user.id,
      ai_provider: aiProvider,
      ai_model: aiModel,
      openai_api_key: openaiKey || null,
      anthropic_api_key: anthropicKey || null,
      updated_at: new Date().toISOString(),
    };

    let error;
    if (settingsId) {
      ({ error } = await supabase.from("account_settings").update(payload).eq("id", settingsId));
    } else {
      const res = await supabase.from("account_settings").insert(payload).select("id").single();
      error = res.error;
      if (res.data) setSettingsId(res.data.id);
    }

    if (error) toast.error("Erro ao salvar configurações");
    else toast.success("Configurações da conta salvas!");
    setSaving(false);
  };

  if (loading) {
    return <div className="flex items-center justify-center h-full"><Loader2 className="h-6 w-6 animate-spin" /></div>;
  }

  const models = modelsByProvider[aiProvider] || modelsByProvider.openai;

  return (
    <div className="p-6 max-w-3xl mx-auto space-y-6 overflow-auto h-full">
      <h1 className="text-2xl font-bold flex items-center gap-2">
        <SlidersHorizontal className="h-6 w-6 text-primary" /> Minha Conta
      </h1>

      <Card>
        <CardHeader>
          <CardTitle>Provedor de IA</CardTitle>
          <CardDescription>Configuração global — vale para todas as suas lojas</CardDescription>
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
              placeholder="sk-..."
              value={aiProvider === "openai" ? openaiKey : anthropicKey}
              onChange={(e) => {
                setVerifyStatus('idle');
                aiProvider === "openai" ? setOpenaiKey(e.target.value) : setAnthropicKey(e.target.value);
              }}
            />
            <div className="flex items-center gap-3 mt-2">
              <Button
                variant="outline"
                size="sm"
                onClick={async () => {
                  setVerifying(true);
                  setVerifyStatus('idle');
                  try {
                    const { data, error } = await supabase.functions.invoke('verify-ai-connection', {
                      body: {
                        provider: aiProvider,
                        api_key: aiProvider === 'anthropic' ? anthropicKey : openaiKey,
                        model: aiModel,
                      },
                    });
                    if (error) throw error;
                    setVerifyStatus(data?.success ? 'success' : 'error');
                  } catch {
                    setVerifyStatus('error');
                  } finally {
                    setVerifying(false);
                  }
                }}
                disabled={verifying || !(aiProvider === "openai" ? openaiKey : anthropicKey)}
                className="gap-2"
              >
                {verifying ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plug className="w-4 h-4" />}
                {verifying ? 'Verificando...' : 'Verificar conexão'}
              </Button>
              {verifyStatus === 'success' && (
                <span className="flex items-center gap-1 text-sm text-green-600">
                  <CheckCircle2 className="w-4 h-4" /> API Key válida!
                </span>
              )}
              {verifyStatus === 'error' && (
                <span className="flex items-center gap-1 text-sm text-destructive">
                  <XCircle className="w-4 h-4" /> API Key inválida. Verifique e tente novamente.
                </span>
              )}
            </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2"><User className="h-5 w-5" /> Dados da Conta</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label>Email</Label>
            <Input value={user?.email || ""} readOnly className="bg-muted" />
          </div>
        </CardContent>
      </Card>

      <Button onClick={handleSave} disabled={saving} className="w-full gap-2">
        <Save className="h-4 w-4" /> {saving ? "Salvando..." : "Salvar configurações da conta"}
      </Button>
    </div>
  );
};

export default AccountSettingsPage;
