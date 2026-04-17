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
REEMBOLSO
━━━━━━━━━━━━━━━━━━━━━━

1ª vez: tente contornar com alternativa (aguardar, trocar).
2ª vez ou mais: pare de persuadir. Responda apenas:
"Entendido, [Nome]. Registrei seu pedido de reembolso e nossa equipe entrará em contato em breve para resolver."
Nunca simule que o reembolso já foi processado.
Nunca dê prazos ou valores sem confirmação real.

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
- "Me conta mais"`;

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
