import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useStore } from "@/contexts/StoreContext";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { Bot, Zap, TrendingUp } from "lucide-react";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

const AIAgentPage = () => {
  const { currentStore } = useStore();
  const [settings, setSettings] = useState<any>(null);

  useEffect(() => {
    if (!currentStore) return;
    supabase.from("settings").select("*").eq("store_id", currentStore.id).maybeSingle().then(({ data }) => {
      setSettings(data);
    });
  }, [currentStore]);

  const toggleActive = async () => {
    if (!settings) return;
    const newVal = !settings.ai_is_active;
    await supabase.from("settings").update({ ai_is_active: newVal }).eq("id", settings.id);
    setSettings({ ...settings, ai_is_active: newVal });
  };

  return (
    <div className="p-6 max-w-3xl mx-auto space-y-6 overflow-auto h-full">
      <h1 className="text-2xl font-bold flex items-center gap-2">
        <Bot className="h-6 w-6 text-primary" /> Agente IA — Sophia
      </h1>

      <div className="grid gap-4 md:grid-cols-3">
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>Status</CardDescription>
          </CardHeader>
          <CardContent className="flex items-center gap-2">
            <div className={`h-3 w-3 rounded-full ${settings?.ai_is_active ? "bg-primary" : "bg-destructive"}`} />
            <span className="font-medium">{settings?.ai_is_active ? "Ativa" : "Inativa"}</span>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>Provedor</CardDescription>
          </CardHeader>
          <CardContent>
            <span className="font-medium capitalize">{settings?.ai_provider || "—"}</span>
            <span className="text-sm text-muted-foreground ml-2">{settings?.ai_model || ""}</span>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>Delay</CardDescription>
          </CardHeader>
          <CardContent>
            <span className="font-medium">{settings?.ai_response_delay || 0}s</span>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Controle</CardTitle>
        </CardHeader>
        <CardContent className="flex items-center justify-between">
          <Label>Ativar respostas automáticas</Label>
          <Switch checked={settings?.ai_is_active || false} onCheckedChange={toggleActive} />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>System Prompt Atual</CardTitle>
          <CardDescription>Prompt usado pela Sophia para gerar respostas</CardDescription>
        </CardHeader>
        <CardContent>
          <Textarea
            value={settings?.ai_system_prompt || "Nenhum prompt configurado"}
            readOnly
            rows={15}
            className="text-xs font-mono bg-muted"
          />
        </CardContent>
      </Card>

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
