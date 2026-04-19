import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useStore } from "@/contexts/StoreContext";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { BarChart3, MessageCircle, Clock, Smile, ShieldCheck, AlertTriangle, TrendingUp, Sparkles, RefreshCw, Bot, Brain, Activity, CheckCircle2, PauseCircle } from "lucide-react";
import { toast } from "sonner";

type SupervisorReport = {
  id: string;
  date: string;
  tickets_analyzed: number | null;
  score: number | null;
  critical_errors: any;
  patterns_found: any;
  prompt_additions: any;
  summary: string | null;
  created_at: string | null;
};

const AnalyticsPage = () => {
  const { currentStore } = useStore();
  const [stats, setStats] = useState({ total: 0, open: 0, closed: 0, avgSentiment: "neutral" });
  const [reports, setReports] = useState<SupervisorReport[]>([]);
  const [loadingReports, setLoadingReports] = useState(false);
  const [runningSupervisor, setRunningSupervisor] = useState(false);
  const [agentStats, setAgentStats] = useState({
    sophiaActive: 0,
    sophiaPaused: 0,
    weekAvgScore: null as number | null,
    lastCerebroRun: null as string | null,
    lastAdditions: [] as string[],
  });

  useEffect(() => {
    if (!currentStore) return;
    const fetch = async () => {
      const { data: tickets } = await supabase
        .from("tickets")
        .select("status, sentiment")
        .eq("store_id", currentStore.id);

      if (tickets) {
        const total = tickets.length;
        const open = tickets.filter((t) => t.status === "open").length;
        const closed = tickets.filter((t) => t.status === "closed").length;

        const sentiments = tickets.map((t) => t.sentiment || "neutral");
        const counts: Record<string, number> = {};
        sentiments.forEach((s) => { counts[s] = (counts[s] || 0) + 1; });
        const avgSentiment = Object.entries(counts).sort((a, b) => b[1] - a[1])[0]?.[0] || "neutral";

        setStats({ total, open, closed, avgSentiment });
      }
    };
    fetch();
  }, [currentStore]);

  const fetchReports = async () => {
    if (!currentStore) return;
    setLoadingReports(true);
    const { data } = await supabase
      .from("supervisor_reports")
      .select("*")
      .eq("store_id", currentStore.id)
      .order("date", { ascending: false })
      .limit(30);
    setReports((data as SupervisorReport[]) || []);
    setLoadingReports(false);
  };

  useEffect(() => {
    fetchReports();
  }, [currentStore]);

  const runSupervisorNow = async () => {
    if (!currentStore) return;
    setRunningSupervisor(true);
    try {
      const { error } = await supabase.functions.invoke("supervisor-agent", {
        body: { storeId: currentStore.id },
      });
      if (error) throw error;
      toast.success("Análise do supervisor executada!");
      await fetchReports();
    } catch (e: any) {
      toast.error("Erro ao executar supervisor: " + e.message);
    } finally {
      setRunningSupervisor(false);
    }
  };

  const sentimentEmoji: Record<string, string> = {
    positive: "😊", neutral: "😐", frustrated: "😤", angry: "😡",
  };

  const scoreColor = (score: number | null) => {
    if (score == null) return "text-muted-foreground";
    if (score >= 8) return "text-green-600";
    if (score >= 6) return "text-yellow-600";
    return "text-red-600";
  };

  const asArray = (val: any): string[] => {
    if (Array.isArray(val)) return val;
    if (typeof val === "string") {
      try { const p = JSON.parse(val); return Array.isArray(p) ? p : []; } catch { return []; }
    }
    return [];
  };

  return (
    <div className="p-6 space-y-6 overflow-auto h-full">
      <h1 className="text-2xl font-bold flex items-center gap-2">
        <BarChart3 className="h-6 w-6 text-primary" /> Analytics
      </h1>

      <Tabs defaultValue="overview" className="w-full">
        <TabsList>
          <TabsTrigger value="overview">Visão Geral</TabsTrigger>
          <TabsTrigger value="supervisor" className="gap-1">
            <ShieldCheck className="h-4 w-4" /> Supervisor IA
          </TabsTrigger>
        </TabsList>

        <TabsContent value="overview" className="space-y-4">
          <div className="grid gap-4 md:grid-cols-4">
            <Card>
              <CardHeader className="pb-2">
                <CardDescription className="flex items-center gap-1">
                  <MessageCircle className="h-4 w-4" /> Total de Tickets
                </CardDescription>
              </CardHeader>
              <CardContent>
                <span className="text-3xl font-bold">{stats.total}</span>
              </CardContent>
            </Card>
            <Card>
              <CardHeader className="pb-2">
                <CardDescription className="flex items-center gap-1">
                  <Clock className="h-4 w-4" /> Abertos
                </CardDescription>
              </CardHeader>
              <CardContent>
                <span className="text-3xl font-bold text-primary">{stats.open}</span>
              </CardContent>
            </Card>
            <Card>
              <CardHeader className="pb-2">
                <CardDescription>Fechados</CardDescription>
              </CardHeader>
              <CardContent>
                <span className="text-3xl font-bold">{stats.closed}</span>
              </CardContent>
            </Card>
            <Card>
              <CardHeader className="pb-2">
                <CardDescription className="flex items-center gap-1">
                  <Smile className="h-4 w-4" /> Sentimento Geral
                </CardDescription>
              </CardHeader>
              <CardContent>
                <span className="text-3xl">{sentimentEmoji[stats.avgSentiment] || "😐"}</span>
                <span className="ml-2 text-sm text-muted-foreground capitalize">{stats.avgSentiment}</span>
              </CardContent>
            </Card>
          </div>
        </TabsContent>

        <TabsContent value="supervisor" className="space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-lg font-semibold flex items-center gap-2">
                <ShieldCheck className="h-5 w-5 text-primary" /> Relatórios do Supervisor
              </h2>
              <p className="text-sm text-muted-foreground">
                Análise automática diária da qualidade do atendimento da Sophia (roda às 23:00).
              </p>
            </div>
            <Button onClick={runSupervisorNow} disabled={runningSupervisor} size="sm" className="gap-2">
              <RefreshCw className={`h-4 w-4 ${runningSupervisor ? "animate-spin" : ""}`} />
              {runningSupervisor ? "Analisando..." : "Rodar agora"}
            </Button>
          </div>

          {loadingReports ? (
            <p className="text-sm text-muted-foreground">Carregando...</p>
          ) : reports.length === 0 ? (
            <Card>
              <CardContent className="py-8 text-center text-muted-foreground">
                Nenhum relatório ainda. Clique em "Rodar agora" para gerar a primeira análise.
              </CardContent>
            </Card>
          ) : (
            <div className="space-y-4">
              {reports.map((r) => {
                const errors = asArray(r.critical_errors);
                const patterns = asArray(r.patterns_found);
                const additions = asArray(r.prompt_additions);
                return (
                  <Card key={r.id}>
                    <CardHeader>
                      <div className="flex items-center justify-between">
                        <CardTitle className="text-base">
                          {new Date(r.date).toLocaleDateString("pt-BR", { day: "2-digit", month: "long", year: "numeric" })}
                        </CardTitle>
                        <div className="flex items-center gap-3">
                          <Badge variant="outline">{r.tickets_analyzed} tickets</Badge>
                          <span className={`text-2xl font-bold ${scoreColor(r.score)}`}>
                            {r.score != null ? Number(r.score).toFixed(1) : "—"}/10
                          </span>
                        </div>
                      </div>
                    </CardHeader>
                    <CardContent className="space-y-3">
                      {r.summary && (
                        <p className="text-sm">{r.summary}</p>
                      )}

                      {errors.length > 0 && (
                        <div>
                          <p className="text-xs font-semibold uppercase text-muted-foreground flex items-center gap-1 mb-1">
                            <AlertTriangle className="h-3 w-3" /> Erros críticos
                          </p>
                          <ul className="text-sm list-disc pl-5 space-y-0.5">
                            {errors.map((e, i) => <li key={i}>{e}</li>)}
                          </ul>
                        </div>
                      )}

                      {patterns.length > 0 && (
                        <div>
                          <p className="text-xs font-semibold uppercase text-muted-foreground flex items-center gap-1 mb-1">
                            <TrendingUp className="h-3 w-3" /> Padrões identificados
                          </p>
                          <ul className="text-sm list-disc pl-5 space-y-0.5">
                            {patterns.map((p, i) => <li key={i}>{p}</li>)}
                          </ul>
                        </div>
                      )}

                      {additions.length > 0 && (
                        <div>
                          <p className="text-xs font-semibold uppercase text-muted-foreground flex items-center gap-1 mb-1">
                            <Sparkles className="h-3 w-3" /> Melhorias aplicadas no prompt
                          </p>
                          <ul className="text-sm list-disc pl-5 space-y-0.5">
                            {additions.map((a, i) => <li key={i}>{a}</li>)}
                          </ul>
                        </div>
                      )}
                    </CardContent>
                  </Card>
                );
              })}
            </div>
          )}
        </TabsContent>
      </Tabs>
    </div>
  );
};

export default AnalyticsPage;
