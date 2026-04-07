import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useStore } from "@/contexts/StoreContext";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { BarChart3, MessageCircle, Clock, Smile } from "lucide-react";

const AnalyticsPage = () => {
  const { currentStore } = useStore();
  const [stats, setStats] = useState({ total: 0, open: 0, closed: 0, avgSentiment: "neutral" });

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

  const sentimentEmoji: Record<string, string> = {
    positive: "😊", neutral: "😐", frustrated: "😤", angry: "😡",
  };

  return (
    <div className="p-6 space-y-6 overflow-auto h-full">
      <h1 className="text-2xl font-bold flex items-center gap-2">
        <BarChart3 className="h-6 w-6 text-primary" /> Analytics
      </h1>

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
    </div>
  );
};

export default AnalyticsPage;
