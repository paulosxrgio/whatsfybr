import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useStore } from "@/contexts/StoreContext";
import { useAuth } from "@/contexts/AuthContext";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { Bot, Save, TrendingUp, ExternalLink, GraduationCap, Trash2, Brain, Play, AlertTriangle } from "lucide-react";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { toast } from "sonner";
import { useNavigate } from "react-router-dom";
import { format } from "date-fns";

type TrainingExample = {
  id: string;
  customer_input: string | null;
  ideal_response: string;
  source: string | null;
  created_at: string;
};

type SupervisorReport = {
  id: string;
  score: number | null;
  prompt_additions: any;
  tickets_analyzed: number | null;
  created_at: string;
};

const getDefaultPrompt = (storeName: string) =>
  `Você é Sophia, atendente de suporte da loja ${storeName} via WhatsApp.

━━━━━━━━━━━━━━━━━━━━━━
REGRA CRÍTICA — NUNCA INVENTE INFORMAÇÕES
━━━━━━━━━━━━━━━━━━━━━━

NUNCA afirme ter verificado algo que não verificou.
NUNCA diga "entrei no sistema e vi que..." a menos que os dados do pedido estejam no contexto.
NUNCA invente status de pedido, rastreamento ou informações de entrega.

Se não há dados do pedido no contexto, diga honestamente:
"Não encontrei seu pedido aqui no sistema. Pode confirmar se a compra foi feita na loja ${storeName}? O número do pedido da ${storeName} começa com #HE ou aparece no email de confirmação da ${storeName}."

NUNCA use um número de pedido como código de rastreamento.
O código de rastreamento é diferente do número do pedido.
Se não houver código de rastreamento, não mande link de rastreamento.

Se o cliente mencionar loja diferente (Patroa, Maria Alice, etc.):
"Oi! Somos a loja ${storeName}. Se sua compra foi feita em outra loja, você precisará entrar em contato com eles diretamente. Posso te ajudar com pedidos feitos na ${storeName}!"


━━━━━━━━━━━━━━━━━━━━━━
PRINCÍPIOS FUNDAMENTAIS
━━━━━━━━━━━━━━━━━━━━━━

Você foi treinada nos padrões das melhores equipes de suporte do mundo — Apple, Spotify, Delta, Amazon. Seu objetivo não é apenas resolver o problema, é fazer o cliente se sentir ouvido e bem tratado.

REGRA DE OURO: Resolva o problema na mesma mensagem sempre que possível. Nunca peça informações que você já tem. Nunca redirecione sem tentar ajudar primeiro.

━━━━━━━━━━━━━━━━━━━━━━
IDIOMA E TOM
━━━━━━━━━━━━━━━━━━━━━━

Sempre responda em português brasileiro, independente do idioma recebido.
Tom: como uma amiga que entende do assunto. Nem robótica, nem informal demais.
Emojis: máximo 1 por mensagem, só quando genuinamente apropriado.

━━━━━━━━━━━━━━━━━━━━━━
ESTRUTURA DE CADA RESPOSTA
━━━━━━━━━━━━━━━━━━━━━━

1. RECONHEÇA — valide o sentimento do cliente em 1 frase (quando há emoção)
2. INFORME — dê a informação ou resolução direta
3. PRÓXIMO PASSO — indique o que acontece agora ou peça UMA coisa se necessário

Nunca inverta essa ordem. Nunca pule o passo 1 quando o cliente estiver frustrado.

━━━━━━━━━━━━━━━━━━━━━━
REGRAS DE FORMATO
━━━━━━━━━━━━━━━━━━━━━━

Mensagens curtas — WhatsApp não é email.
Máximo 3 parágrafos curtos.
Nunca use listas, bullet points ou Markdown.
Para agradecimentos: responda com 1 linha calorosa.
Links de rastreamento em linha separada.
Assine sempre: Abraços, Sophia

━━━━━━━━━━━━━━━━━━━━━━
ABERTURA DAS MENSAGENS — VARIAR SEMPRE
━━━━━━━━━━━━━━━━━━━━━━

Nunca repita a mesma abertura duas vezes. Exemplos por situação:

Cliente com problema → "Entendo, [Nome]! Vou verificar isso agora."
Cliente frustrado → "Que chato, [Nome]! Me conta mais para eu resolver."
Cliente satisfeito → "Que bom ouvir isso, [Nome]! 😊"
Pergunta simples → "Oi [Nome]! [resposta direta]"
Urgência → "[Nome], entendo a urgência. Deixa eu ver o que posso fazer."
Follow-up → "Oi [Nome], vi que você voltou. Como posso te ajudar?"

━━━━━━━━━━━━━━━━━━━━━━
PERGUNTAS — UMA POR VEZ
━━━━━━━━━━━━━━━━━━━━━━

NUNCA faça mais de uma pergunta por mensagem.
Se precisar de 3 informações, peça a mais importante primeiro.
Ruim: "Pode me informar o número do pedido, seu email e o problema?"
Bom: "Pode me passar o número do pedido para eu verificar?"

━━━━━━━━━━━━━━━━━━━━━━
CONTINUIDADE — VOCÊ LEMBRA DE TUDO
━━━━━━━━━━━━━━━━━━━━━━

Leia TODO o histórico antes de responder.
Se o cliente já disse o número do pedido: não peça de novo.
Se já explicou o problema: não peça para repetir.
Se já foi enviado link de rastreamento: não mande de novo.
Se o cliente mencionou urgência antes: lembre disso agora.
Use referências naturais: "Como você mencionou antes..." ou "Desde que falamos na última vez..."

━━━━━━━━━━━━━━━━━━━━━━
SENTIMENTO — ADAPTE O TOM
━━━━━━━━━━━━━━━━━━━━━━

POSITIVO: seja breve, leve, calorosa. Não exagere.
NEUTRO: direto ao ponto, profissional, eficiente.
FRUSTRADO: valide PRIMEIRO ("Entendo sua frustração"), depois resolva. Nunca seja defensiva.
FURIOSO: total calma. Nunca se justifique antes de se desculpar. Uma coisa por vez.

Quando cliente está com raiva:
Ruim: "Lamentamos o ocorrido, mas segundo nossas políticas..."
Bom: "Que situação chata, [Nome]. Me deixa ver o que aconteceu com o seu pedido."

━━━━━━━━━━━━━━━━━━━━━━
RASTREAMENTO
━━━━━━━━━━━━━━━━━━━━━━

Use SEMPRE este formato (link da própria loja, NUNCA trackingmore):
https://adorisse.com.br/apps/parcelpanel?nums=CODIGO

Coloque o link em linha separada.
Explique que o produto vem diretamente do fabricante — atualizações acontecem por checkpoints e podem parecer lentas entre eles, mas o pedido está em movimento.
Prazo padrão: 8 a 12 dias úteis a partir do despacho.

━━━━━━━━━━━━━━━━━━━━━━
REEMBOLSO E CANCELAMENTO
━━━━━━━━━━━━━━━━━━━━━━

PRIMEIRA MENÇÃO de reembolso/cancelamento/devolução:
Seja extremamente empática, acolhedora e tranquilizadora.
Tente entender o motivo real e ofereça uma solução alternativa antes de aceitar o reembolso.

Exemplos de contorno:
- Pedido atrasado → mostre o rastreamento, reafirme o prazo
- Produto errado → ofereça troca
- Arrependimento → destaque os benefícios do produto
- Prazo → explique que está a caminho

Tom obrigatório na 1ª menção:
"Fico muito triste em saber que você está pensando em cancelar 😢 Antes de tudo, me conta o que aconteceu? Quero muito resolver isso pra você da melhor forma possível!"

SEGUNDA MENÇÃO ou insistência no reembolso:
Aceite sem resistência, com simpatia total. NÃO tente mais convencer.
Direcione para o formulário com carinho:

"Tudo bem, entendo completamente e respeito sua decisão 💛 Para que possamos processar seu reembolso o mais rápido possível, peço gentilmente que preencha nosso formulário pelo link abaixo — nossa equipe vai cuidar de tudo com prioridade:

👉 https://reembolso.adorisse.com/

Assim que receber, trataremos com toda atenção que você merece. Se precisar de qualquer outra coisa, estarei aqui! 🌸"

REGRAS ABSOLUTAS sobre reembolso:
- NUNCA seja fria, burocrática ou dificulte o processo
- NUNCA diga "não podemos" ou "não é possível"
- NUNCA ignore o sentimento da cliente antes de responder
- SEMPRE use tom acolhedor, como se fosse uma amiga ajudando
- SEMPRE encaminhe para https://reembolso.adorisse.com/ na 2ª menção
- Após enviar o link, deseje um bom dia/tarde/noite com carinho

━━━━━━━━━━━━━━━━━━━━━━
URGÊNCIA E DATAS ESPECIAIS
━━━━━━━━━━━━━━━━━━━━━━

Se o cliente mencionar: presente, viagem, data especial, mudança, evento → reconheça PRIMEIRO na abertura da resposta antes de qualquer informação técnica.
Exemplo: "Entendo que é para um presente especial, [Nome] — vou verificar agora o que posso fazer."

━━━━━━━━━━━━━━━━━━━━━━
MÚLTIPLAS MENSAGENS CONSOLIDADAS
━━━━━━━━━━━━━━━━━━━━━━

Se o cliente enviou várias mensagens seguidas, responda tudo de forma natural em UMA mensagem coesa. Não mencione que eram várias mensagens. Não numere as respostas. Flua naturalmente como uma conversa.

━━━━━━━━━━━━━━━━━━━━━━
SPAM E GOLPES
━━━━━━━━━━━━━━━━━━━━━━

Sinais: "parceiro Shopify", pede acesso à loja, pede pagamento, pede WhatsApp para "proposta", menciona "GO-PRO", "SALESPROX", "RGSS", promete vendas de $1k-$10k/semana.

Resposta única e definitiva:
"Oi! Este canal é exclusivo para suporte de pedidos existentes. Abraços, Sophia"

Nunca engaje. Nunca elogie. Nunca prometa passar para o dono.

━━━━━━━━━━━━━━━━━━━━━━
FRASES PROIBIDAS
━━━━━━━━━━━━━━━━━━━━━━

Nunca use:
- "Espero que esteja bem"
- "Fico feliz em ajudar"
- "Agradeço por entrar em contato"
- "Como posso te ajudar hoje?"
- "Lamento o transtorno causado"
- "Conforme nossas políticas..."
- Qualquer frase que um robô típico usaria

━━━━━━━━━━━━━━━━━━━━━━
FRASES QUE HUMANIZAM
━━━━━━━━━━━━━━━━━━━━━━

Use naturalmente quando apropriado:
- "Deixa eu verificar agora"
- "Que situação chata, vamos resolver"
- "Vi aqui no sistema que..."
- "Faz sentido você estar preocupado"
- "Boa notícia!"
- "Já cuido disso"
- "Me conta mais"

━━━━━━━━━━━━━━━━━━━━━━
IMAGENS E MÍDIAS
━━━━━━━━━━━━━━━━━━━━━━

- Quando ver [Imagem: descrição] no histórico, use essa descrição para responder — você JÁ viu a imagem.
- Comprovante de pagamento → confirme recebimento e verifique no pedido
- Print de anúncio/produto → identifique se é da Adorisse pelo domínio adorisse.com.br
- Foto de produto recebido com problema → registre como solicitação de troca
- NUNCA diga que não consegue ver imagens — agora você consegue.
- Se a descrição vier como [Imagem recebida — não foi possível analisar], peça gentilmente: "Recebi sua imagem, mas tive um problema ao processá-la. Pode me descrever rapidinho?"`;

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
  const [trainingExamples, setTrainingExamples] = useState<TrainingExample[]>([]);
  const [trainingLoading, setTrainingLoading] = useState(false);
  const [editMode, setEditMode] = useState(false);
  const [lastReport, setLastReport] = useState<SupervisorReport | null>(null);
  const [promptUpdatedAt, setPromptUpdatedAt] = useState<string | null>(null);
  const [forcingAnalysis, setForcingAnalysis] = useState(false);

  const fetchTrainingExamples = async () => {
    if (!currentStore) return;
    setTrainingLoading(true);
    const { data } = await supabase
      .from("training_examples")
      .select("id, customer_input, ideal_response, source, created_at")
      .eq("store_id", currentStore.id)
      .order("created_at", { ascending: false })
      .limit(50);
    setTrainingExamples((data as TrainingExample[]) || []);
    setTrainingLoading(false);
  };

  const fetchLastReport = async () => {
    if (!currentStore) return;
    const { data } = await supabase
      .from("supervisor_reports")
      .select("id, score, prompt_additions, tickets_analyzed, created_at")
      .eq("store_id", currentStore.id)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    setLastReport((data as SupervisorReport) || null);
  };

  useEffect(() => {
    if (currentStore) {
      fetchTrainingExamples();
      fetchLastReport();
    }
  }, [currentStore]);

  const handleForceAnalysis = async () => {
    if (!currentStore) return;
    setForcingAnalysis(true);
    const { error } = await supabase.functions.invoke("supervisor-agent", {
      body: { store_id: currentStore.id },
    });
    if (error) {
      toast.error("Erro ao forçar análise");
    } else {
      toast.success("Análise iniciada! Aguarde alguns segundos.");
      setTimeout(() => fetchLastReport(), 5000);
    }
    setForcingAnalysis(false);
  };

  const deleteExample = async (id: string) => {
    const { error } = await supabase.from("training_examples").delete().eq("id", id);
    if (error) {
      toast.error("Erro ao excluir exemplo");
      return;
    }
    setTrainingExamples((prev) => prev.filter((e) => e.id !== id));
    toast.success("Exemplo excluído");
  };

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
    const payload: any = {
      store_id: currentStore.id,
      ai_is_active: aiIsActive,
      ai_response_delay: aiDelay,
    };
    if (editMode) {
      payload.ai_system_prompt = aiPrompt;
    }

    let error;
    if (settingsId) {
      ({ error } = await supabase.from("settings").update(payload).eq("id", settingsId));
    } else {
      const res = await supabase.from("settings").insert(payload).select("id").single();
      error = res.error;
      if (res.data) setSettingsId(res.data.id);
    }

    if (error) toast.error("Erro ao salvar configurações");
    else {
      toast.success("Configurações salvas!");
      if (editMode) setEditMode(false);
    }
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

      <Tabs defaultValue="config" className="w-full">
        <TabsList className="grid w-full grid-cols-2">
          <TabsTrigger value="config" className="gap-2">
            <Bot className="h-4 w-4" /> Configuração
          </TabsTrigger>
          <TabsTrigger value="training" className="gap-2">
            <GraduationCap className="h-4 w-4" /> Treinamento
            {trainingExamples.length > 0 && (
              <span className="ml-1 text-xs bg-primary/10 text-primary px-1.5 py-0.5 rounded-full">
                {trainingExamples.length}
              </span>
            )}
          </TabsTrigger>
        </TabsList>

        <TabsContent value="config" className="space-y-6 mt-6">
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

          {/* Cérebro status card */}
          <Card className="bg-muted/30">
            <CardContent className="pt-6">
              <div className="flex items-center justify-between mb-3">
                <h4 className="text-sm font-semibold flex items-center gap-2">
                  <Brain className="h-4 w-4 text-primary" /> Agente Cérebro
                </h4>
                <span className="text-xs bg-primary/10 text-primary px-2 py-0.5 rounded-full">
                  ativo
                </span>
              </div>
              <div className="grid grid-cols-3 gap-3 text-xs text-muted-foreground">
                <div>
                  <p className="font-medium text-foreground text-base">
                    {lastReport?.score != null ? `${lastReport.score}/10` : "—"}
                  </p>
                  <p>Score de ontem</p>
                </div>
                <div>
                  <p className="font-medium text-foreground text-base">
                    {Array.isArray(lastReport?.prompt_additions) ? lastReport!.prompt_additions.length : 0}
                  </p>
                  <p>Regras adicionadas</p>
                </div>
                <div>
                  <p className="font-medium text-foreground text-base">
                    {lastReport?.tickets_analyzed ?? 0}
                  </p>
                  <p>Conversas analisadas</p>
                </div>
              </div>
              <Button
                variant="outline"
                size="sm"
                onClick={handleForceAnalysis}
                disabled={forcingAnalysis}
                className="mt-3 gap-2"
              >
                <Play className="h-3 w-3" /> {forcingAnalysis ? "Analisando..." : "Forçar análise agora"}
              </Button>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <div className="flex items-center justify-between">
                <CardTitle>System Prompt</CardTitle>
                <div className="flex items-center gap-2">
                  <span className="text-xs text-muted-foreground bg-muted px-2 py-0.5 rounded-full flex items-center gap-1">
                    <Brain className="h-3 w-3" /> Gerenciado pelo Cérebro
                  </span>
                  {lastReport?.created_at && (
                    <span className="text-xs text-muted-foreground">
                      Última atualização: {format(new Date(lastReport.created_at), "dd/MM HH:mm")}
                    </span>
                  )}
                </div>
              </div>
            </CardHeader>
            <CardContent className="space-y-3">
              {editMode && (
                <div className="border border-warning/40 bg-warning/10 rounded-md p-3 flex gap-2">
                  <AlertTriangle className="h-4 w-4 text-warning flex-shrink-0 mt-0.5" />
                  <p className="text-xs text-foreground">
                    Você está editando manualmente. A próxima análise do Cérebro irá adicionar regras ao final deste prompt, mas não apagará o que você escrever aqui.
                  </p>
                </div>
              )}

              <Textarea
                value={aiPrompt}
                onChange={(e) => editMode && setAiPrompt(e.target.value)}
                readOnly={!editMode}
                rows={editMode ? 18 : 8}
                className={
                  editMode
                    ? "text-xs font-mono"
                    : "text-xs font-mono bg-muted/50 border-dashed text-muted-foreground resize-none cursor-default opacity-70"
                }
              />

              <p className="text-xs text-muted-foreground">
                ℹ️ Este prompt é atualizado automaticamente pelo agente Cérebro todo dia às 23h com base nas conversas do dia.
              </p>

              {!editMode ? (
                <button
                  onClick={() => setEditMode(true)}
                  className="text-xs text-muted-foreground underline hover:text-foreground"
                >
                  Editar manualmente (modo avançado)
                </button>
              ) : (
                <div className="flex gap-2">
                  <Button onClick={handleSave} disabled={saving} size="sm" className="gap-2">
                    <Save className="h-4 w-4" /> {saving ? "Salvando..." : "Salvar prompt"}
                  </Button>
                  <Button
                    onClick={() => setEditMode(false)}
                    variant="ghost"
                    size="sm"
                  >
                    Cancelar
                  </Button>
                </div>
              )}
            </CardContent>
          </Card>

          {!editMode && (
            <Button onClick={handleSave} disabled={saving} variant="outline" className="w-full gap-2">
              <Save className="h-4 w-4" /> {saving ? "Salvando..." : "Salvar configurações gerais"}
            </Button>
          )}

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2"><TrendingUp className="h-5 w-5" /> Sugestões de Melhoria</CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-sm text-muted-foreground">As sugestões serão geradas com base nas interações da Sophia com os clientes.</p>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="training" className="space-y-4 mt-6">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <GraduationCap className="h-5 w-5" /> Exemplos de Treinamento
              </CardTitle>
              <CardDescription>
                Quando você pausa a IA num ticket e responde manualmente, sua resposta é salva aqui como exemplo. A Sophia usa os 10 mais recentes para imitar seu estilo.
              </CardDescription>
            </CardHeader>
            <CardContent>
              {trainingLoading ? (
                <p className="text-sm text-muted-foreground text-center py-8">Carregando...</p>
              ) : trainingExamples.length === 0 ? (
                <p className="text-sm text-muted-foreground text-center py-8">
                  Nenhum exemplo ainda. Pause a IA num ticket e responda manualmente para criar exemplos.
                </p>
              ) : (
                <div className="space-y-3">
                  {trainingExamples.map((ex) => (
                    <div key={ex.id} className="border rounded-lg p-3 space-y-2 bg-muted/30">
                      <div className="flex items-center justify-between">
                        <span className="text-xs text-muted-foreground">
                          {format(new Date(ex.created_at), "dd/MM/yyyy HH:mm")} · {ex.source || "human_operator"}
                        </span>
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => deleteExample(ex.id)}
                          className="h-7 w-7 p-0 text-destructive hover:text-destructive hover:bg-destructive/10"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </Button>
                      </div>
                      <div>
                        <p className="text-xs font-semibold text-muted-foreground mb-1">Cliente disse:</p>
                        <p className="text-sm whitespace-pre-wrap line-clamp-3">{ex.customer_input || "—"}</p>
                      </div>
                      <div>
                        <p className="text-xs font-semibold text-muted-foreground mb-1">Resposta ideal:</p>
                        <p className="text-sm whitespace-pre-wrap line-clamp-4">{ex.ideal_response}</p>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
};

export default AIAgentPage;
