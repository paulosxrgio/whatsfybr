import { useEffect, useState, useRef, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useStore } from "@/contexts/StoreContext";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Send, Bot, Search, Phone, Mail, CheckCircle, RefreshCw, Globe, StickyNote, MessageSquare, CheckCheck, Loader2, Clock, TrendingUp, Headphones, HelpCircle, ShoppingBag, Package, ExternalLink, Copy, Download } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { format, isToday, isSameDay } from "date-fns";

type Ticket = {
  id: string;
  store_id: string;
  customer_name: string | null;
  customer_phone: string;
  status: string | null;
  sentiment: string | null;
  last_message_at: string | null;
  created_at: string | null;
  intent?: string | null;
  hasPendingQueue?: boolean;
  pendingMessageCount?: number;
};

type Message = {
  id: string;
  ticket_id: string;
  content: string | null;
  direction: string;
  message_type: string | null;
  media_url: string | null;
  created_at: string | null;
};

type CustomerMemory = {
  customer_name: string | null;
  customer_phone: string;
  total_interactions: number | null;
  last_sentiment: string | null;
  preferred_language: string | null;
  notes: string | null;
};

type ShopifyOrder = {
  order_number: string;
  created_at: string;
  financial_status: string;
  fulfillment_status: string;
  total_price: string;
  currency: string;
  tracking_number: string | null;
  tracking_url: string | null;
  tracking_company: string | null;
  line_items: { title: string; quantity: number; variant: string | null }[];
};

const sentimentEmoji: Record<string, string> = {
  positive: "😊",
  neutral: "😐",
  frustrated: "😤",
  angry: "😡",
};

const TicketsPage = () => {
  const { currentStore } = useStore();
  const [tickets, setTickets] = useState<Ticket[]>([]);
  const [selectedTicket, setSelectedTicket] = useState<Ticket | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [newMessage, setNewMessage] = useState("");
  const [filter, setFilter] = useState<"all" | "open" | "closed">("all");
  const [search, setSearch] = useState("");
  const [sending, setSending] = useState(false);
  const [isGenerating, setIsGenerating] = useState(false);
  const [customerMemory, setCustomerMemory] = useState<CustomerMemory | null>(null);
  const [aiIsActive, setAiIsActive] = useState(false);
  const [shopifyOrders, setShopifyOrders] = useState<ShopifyOrder[]>([]);
  const [shopifyCustomer, setShopifyCustomer] = useState<{ name: string } | null>(null);
  const [shopifyLoading, setShopifyLoading] = useState(false);
  const [shopifyError, setShopifyError] = useState<string | null>(null);
  const [exportModal, setExportModal] = useState(false);
  const [exportPeriod, setExportPeriod] = useState('today');
  const [exporting, setExporting] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const periodOptions = [
    { value: 'today', label: 'Hoje' },
    { value: '2', label: 'Últimos 2 dias' },
    { value: '5', label: 'Últimos 5 dias' },
    { value: '7', label: 'Últimos 7 dias' },
    { value: '15', label: 'Últimos 15 dias' },
    { value: '30', label: 'Últimos 30 dias' },
    { value: 'all', label: 'Todo o período' },
  ];

  const handleExport = async () => {
    if (!currentStore) return;
    setExporting(true);
    try {
      let startDate: string | null = null;
      if (exportPeriod === 'today') {
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        startDate = today.toISOString();
      } else if (exportPeriod !== 'all') {
        const days = parseInt(exportPeriod);
        startDate = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
      }

      let ticketsQuery = supabase
        .from('tickets')
        .select('id, customer_name, customer_phone, status, sentiment, created_at, last_message_at')
        .eq('store_id', currentStore.id)
        .order('last_message_at', { ascending: false });

      if (startDate) {
        ticketsQuery = ticketsQuery.gte('last_message_at', startDate);
      }

      const { data: ticketsData } = await ticketsQuery;
      if (!ticketsData || ticketsData.length === 0) {
        toast.error('Nenhuma conversa encontrada no período selecionado.');
        return;
      }

      const lines: string[] = [];
      const periodLabel = periodOptions.find(p => p.value === exportPeriod)?.label || '';

      lines.push(`SUPORTFY — EXPORT DE CONVERSAS`);
      lines.push(`Loja: ${currentStore?.name || 'Adorisse'}`);
      lines.push(`Período: ${periodLabel}`);
      lines.push(`Exportado em: ${new Date().toLocaleString('pt-BR')}`);
      lines.push(`Total de conversas: ${ticketsData.length}`);
      lines.push('');

      for (const ticket of ticketsData) {
        const { data: msgs } = await supabase
          .from('messages')
          .select('content, direction, message_type, created_at')
          .eq('ticket_id', ticket.id)
          .order('created_at', { ascending: true });

        lines.push('═'.repeat(60));
        lines.push(`Cliente: ${ticket.customer_name || 'Sem nome'}`);
        lines.push(`Telefone: ${ticket.customer_phone}`);
        lines.push(`Status: ${ticket.status === 'open' ? 'Aberto' : 'Fechado'}`);
        lines.push(`Sentimento: ${ticket.sentiment || 'neutro'}`);
        lines.push(`Início: ${ticket.created_at ? new Date(ticket.created_at).toLocaleString('pt-BR') : '-'}`);
        lines.push(`Última msg: ${ticket.last_message_at ? new Date(ticket.last_message_at).toLocaleString('pt-BR') : '-'}`);
        lines.push(`Total de mensagens: ${msgs?.length || 0}`);
        lines.push('─'.repeat(60));

        let lastDate = '';
        for (const msg of msgs || []) {
          if (!msg.created_at) continue;
          const msgDate = new Date(msg.created_at);
          const dateStr = msgDate.toLocaleDateString('pt-BR');
          const timeStr = msgDate.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });

          if (dateStr !== lastDate) {
            lines.push(`── ${dateStr} ──`);
            lastDate = dateStr;
          }

          const author = msg.direction === 'outbound' ? '🤖 Sophia' : `👤 ${ticket.customer_name || 'Cliente'}`;
          const content =
            msg.message_type === 'image' ? `[📷 Imagem${msg.content ? ': ' + msg.content : ''}]` :
            msg.message_type === 'audio' ? `[🎤 Áudio${msg.content ? ': ' + msg.content : ''}]` :
            msg.message_type === 'video' ? '[🎥 Vídeo]' :
            msg.message_type === 'document' ? '[📄 Documento]' :
            msg.content || '';

          lines.push(`[${timeStr}] ${author}`);
          lines.push(content);
          lines.push('');
        }
      }

      lines.push('═'.repeat(60));
      lines.push(`FIM DO EXPORT — ${ticketsData.length} conversa(s)`);

      const blob = new Blob([lines.join('\n')], { type: 'text/plain;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `conversas_${periodLabel.toLowerCase().replace(/ /g, '_')}_${new Date().toLocaleDateString('pt-BR').replace(/\//g, '-')}.txt`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);

      toast.success(`${ticketsData.length} conversa(s) exportada(s) com sucesso!`);
      setExportModal(false);
    } catch (e) {
      toast.error('Erro ao exportar conversas');
    } finally {
      setExporting(false);
    }
  };

  // Copiar conversa completa como texto formatado
  const copyChat = useCallback(async () => {
    if (!messages || messages.length === 0) return;
    const lines: string[] = [];
    lines.push(`━━━━━━━━━━━━━━━━━━━━━━`);
    lines.push(`Conversa: ${selectedTicket?.customer_name || selectedTicket?.customer_phone}`);
    lines.push(`Telefone: ${selectedTicket?.customer_phone}`);
    lines.push(`Status: ${selectedTicket?.status}`);
    lines.push(`Exportado em: ${new Date().toLocaleString('pt-BR')}`);
    lines.push(`━━━━━━━━━━━━━━━━━━━━━━`);
    lines.push('');
    let lastDate = '';
    for (const msg of messages) {
      if (!msg.created_at) continue;
      const msgDate = new Date(msg.created_at);
      const dateStr = msgDate.toLocaleDateString('pt-BR');
      const timeStr = msgDate.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
      if (dateStr !== lastDate) {
        lines.push(`── ${dateStr} ──`);
        lines.push('');
        lastDate = dateStr;
      }
      const author = msg.direction === 'outbound' ? '🤖 Sophia' : `👤 ${selectedTicket?.customer_name || 'Cliente'}`;
      let content = '';
      if (msg.message_type === 'image') {
        content = msg.content ? `[📷 Imagem — ${msg.content}]` : '[📷 Imagem recebida]';
      } else if (msg.message_type === 'audio') {
        content = msg.content ? `[🎤 Áudio transcrito: "${msg.content}"]` : '[🎤 Áudio recebido]';
      } else if (msg.message_type === 'video') {
        content = '[🎥 Vídeo recebido]';
      } else if (msg.message_type === 'document') {
        content = '[📄 Documento recebido]';
      } else if (msg.message_type === 'sticker') {
        content = '[🎨 Sticker]';
      } else {
        content = msg.content || '';
      }
      lines.push(`[${timeStr}] ${author}`);
      lines.push(content);
      lines.push('');
    }
    lines.push(`━━━━━━━━━━━━━━━━━━━━━━`);
    lines.push(`Total de mensagens: ${messages.length}`);
    const fullText = lines.join('\n');
    try {
      await navigator.clipboard.writeText(fullText);
      toast.success('Chat copiado para a área de transferência!');
    } catch {
      const textarea = document.createElement('textarea');
      textarea.value = fullText;
      textarea.style.position = 'fixed';
      textarea.style.opacity = '0';
      document.body.appendChild(textarea);
      textarea.select();
      document.execCommand('copy');
      document.body.removeChild(textarea);
      toast.success('Chat copiado!');
    }
  }, [messages, selectedTicket]);

  const fetchTickets = async () => {
    if (!currentStore) return;
    let query = supabase
      .from("tickets")
      .select("*, auto_reply_queue(id, status, message_count)")
      .eq("store_id", currentStore.id)
      .order("last_message_at", { ascending: false });

    if (filter === "open") query = query.eq("status", "open");
    if (filter === "closed") query = query.eq("status", "closed");

    const { data } = await query;
    if (data) {
      const ticketsWithQueue = data.map((t: any) => ({
        ...t,
        hasPendingQueue: t.auto_reply_queue?.some((q: any) => q.status === "pending"),
        pendingMessageCount: t.auto_reply_queue?.find((q: any) => q.status === "pending")?.message_count || 0,
        auto_reply_queue: undefined,
      }));
      setTickets(ticketsWithQueue);
    }
  };

  useEffect(() => {
    if (!currentStore) return;
    fetchTickets();

    // Fetch AI active status
    supabase
      .from("settings")
      .select("ai_is_active")
      .eq("store_id", currentStore.id)
      .maybeSingle()
      .then(({ data }) => setAiIsActive(data?.ai_is_active ?? false));

    const channel = supabase
      .channel("tickets-realtime")
      .on("postgres_changes", { event: "*", schema: "public", table: "tickets", filter: `store_id=eq.${currentStore.id}` }, () => {
        fetchTickets();
      })
      .subscribe();

    return () => { supabase.removeChannel(channel); };
  }, [currentStore, filter]);

  useEffect(() => {
    if (!selectedTicket) return;
    const fetchMessages = async () => {
      const { data } = await supabase
        .from("messages")
        .select("*")
        .eq("ticket_id", selectedTicket.id)
        .order("created_at", { ascending: true });
      if (data) setMessages(data);
    };
    fetchMessages();

    const channel = supabase
      .channel("messages-realtime")
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "messages", filter: `ticket_id=eq.${selectedTicket.id}` }, (payload) => {
        setMessages((prev) => [...prev, payload.new as Message]);
      })
      .subscribe();

    return () => { supabase.removeChannel(channel); };
  }, [selectedTicket]);

  // Auto-scroll to last message
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  // Fetch customer memory
  useEffect(() => {
    if (!selectedTicket || !currentStore) {
      setCustomerMemory(null);
      return;
    }
    const fetchMemory = async () => {
      const { data } = await supabase
        .from("customer_memory")
        .select("*")
        .eq("store_id", currentStore.id)
        .eq("customer_phone", selectedTicket.customer_phone)
        .maybeSingle();
      setCustomerMemory(data as CustomerMemory | null);
    };
    fetchMemory();
  }, [selectedTicket, currentStore]);

  // Fetch Shopify orders
  useEffect(() => {
    if (!selectedTicket || !currentStore) {
      setShopifyOrders([]);
      setShopifyCustomer(null);
      setShopifyError(null);
      return;
    }
    const fetchOrders = async () => {
      setShopifyLoading(true);
      setShopifyError(null);
      try {
        const { data, error } = await supabase.functions.invoke("fetch-shopify-orders", {
          body: { store_id: currentStore.id, customer_phone: selectedTicket.customer_phone, customer_name: selectedTicket.customer_name },
        });
        if (error) throw error;
        if (data?.configured === false) {
          setShopifyError("not_configured");
        } else {
          const mappedOrders = (data?.orders || []).map((o: any) => ({
            ...o,
            fulfillment_status: o.fulfillment_status || o.status || "unfulfilled",
            line_items: (o.line_items || o.items || []).map((i: any) => ({
              title: i.title,
              quantity: i.quantity,
              variant: i.variant_title || i.variant || null,
            })),
          }));
          setShopifyOrders(mappedOrders);
          setShopifyCustomer(data?.customer || null);
        }
      } catch {
        setShopifyError("error");
      }
      setShopifyLoading(false);
    };
    fetchOrders();
  }, [selectedTicket, currentStore]);

  const handleSend = async () => {
    if (!newMessage.trim() || !selectedTicket || !currentStore) return;
    setSending(true);
    try {
      const { error } = await supabase.functions.invoke("send-whatsapp-reply", {
        body: { ticket_id: selectedTicket.id, message: newMessage, store_id: currentStore.id },
      });
      if (error) throw error;
      setNewMessage("");
    } catch {
      toast.error("Erro ao enviar mensagem");
    }
    setSending(false);
  };

  const handleGenerateAiReply = async () => {
    if (!selectedTicket || !currentStore) return;
    setIsGenerating(true);
    try {
      // Trigger the scheduler manually or generate a suggestion
      toast.info("Gerando resposta com IA...");
      // For now just enqueue
      await supabase.from("auto_reply_queue").insert({
        ticket_id: selectedTicket.id,
        store_id: currentStore.id,
        status: "pending",
        scheduled_for: new Date().toISOString(),
      });
      toast.success("Resposta IA enfileirada!");
    } catch {
      toast.error("Erro ao gerar resposta IA");
    }
    setIsGenerating(false);
  };

  const toggleTicketStatus = async () => {
    if (!selectedTicket) return;
    const newStatus = selectedTicket.status === "open" ? "closed" : "open";
    const { error } = await supabase
      .from("tickets")
      .update({ status: newStatus })
      .eq("id", selectedTicket.id);
    if (error) {
      toast.error("Erro ao atualizar ticket");
      return;
    }
    setSelectedTicket({ ...selectedTicket, status: newStatus });
    fetchTickets();
    toast.success(newStatus === "closed" ? "Ticket fechado!" : "Ticket reaberto!");
  };

  const simulateMessage = async () => {
    if (!currentStore) return;
    try {
      const { data, error } = await supabase.functions.invoke("process-inbound-whatsapp", {
        body: {
          waitingMessage: false,
          isGroup: false,
          instanceId: "test",
          messageId: `test-${Date.now()}`,
          phone: "5511999999999",
          fromMe: false,
          momment: Date.now(),
          status: "RECEIVED",
          chatName: "Cliente Teste",
          senderName: "Cliente Teste",
          broadcast: false,
          type: "ReceivedCallback",
          text: { message: "Olá, quero saber sobre meu pedido!" },
          store_id: currentStore.id,
        },
      });
      if (error) {
        toast.error("Erro ao simular: " + error.message);
      } else {
        toast.success("Mensagem simulada! Verifique a lista.");
        fetchTickets();
      }
    } catch {
      toast.error("Erro ao simular mensagem");
    }
  };

  const filteredTickets = tickets.filter((t) => {
    if (!search) return true;
    return (
      t.customer_name?.toLowerCase().includes(search.toLowerCase()) ||
      t.customer_phone.includes(search)
    );
  });

  return (
    <div className="flex h-screen overflow-hidden">
      {/* Ticket List */}
      <div className="w-80 flex-shrink-0 border-r flex flex-col h-full bg-card overflow-hidden">
        <div className="flex-shrink-0 p-3 space-y-2 border-b">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Buscar..."
              className="pl-9"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
          <div className="flex gap-1">
            {(["all", "open", "closed"] as const).map((f) => (
              <Button
                key={f}
                variant={filter === f ? "default" : "ghost"}
                size="sm"
                onClick={() => setFilter(f)}
                className="flex-1 text-xs"
              >
                {f === "all" ? "Todos" : f === "open" ? "Abertos" : "Fechados"}
              </Button>
            ))}
          </div>
          <button
            onClick={simulateMessage}
            className="w-full text-xs px-3 py-1 rounded border border-dashed border-green-500 text-green-600 hover:bg-green-50"
          >
            + Simular mensagem
          </button>
          <button
            onClick={() => setExportModal(true)}
            className="w-full flex items-center justify-center gap-1.5 text-xs px-3 py-1.5 rounded-lg border hover:bg-muted transition-colors"
          >
            <Download className="w-3.5 h-3.5" />
            Exportar
          </button>
        </div>
        <ScrollArea className="flex-1 min-h-0">
          {filteredTickets.map((ticket) => (
            <button
              key={ticket.id}
              className={cn(
                "w-full p-3 flex items-start gap-3 text-left hover:bg-muted/50 border-b transition-colors",
                selectedTicket?.id === ticket.id && "bg-accent"
              )}
              onClick={() => setSelectedTicket(ticket)}
            >
              <Avatar className="h-10 w-10 shrink-0">
                <AvatarFallback className="bg-primary/10 text-primary text-sm font-semibold">
                  {(ticket.customer_name || ticket.customer_phone).charAt(0).toUpperCase()}
                </AvatarFallback>
              </Avatar>
              <div className="flex-1 min-w-0">
                <div className="flex items-center justify-between">
                  <span className="font-medium text-sm truncate">
                    {ticket.customer_name || ticket.customer_phone}
                  </span>
                  <span className="text-xs text-muted-foreground">
                    {ticket.last_message_at && format(new Date(ticket.last_message_at), "HH:mm")}
                  </span>
                </div>
                <div className="flex items-center justify-between mt-0.5">
                  <span className="text-xs text-muted-foreground truncate">
                    {ticket.customer_phone}
                  </span>
                  <div className="flex items-center gap-1">
                    {ticket.hasPendingQueue && (
                      <span className="text-xs bg-yellow-100 text-yellow-700 px-2 py-0.5 rounded-full flex items-center gap-1">
                        <Clock className="w-3 h-3" />
                        {ticket.pendingMessageCount && ticket.pendingMessageCount > 1 ? `${ticket.pendingMessageCount}` : ""}
                      </span>
                    )}
                    <span className="text-sm">{sentimentEmoji[ticket.sentiment || "neutral"] || "😐"}</span>
                  </div>
                </div>
              </div>
            </button>
          ))}
          {filteredTickets.length === 0 && (
            <p className="p-4 text-center text-sm text-muted-foreground">Nenhum ticket encontrado</p>
          )}
        </ScrollArea>
      </div>

      {/* Chat Area */}
      <div className="flex-1 flex flex-col min-w-0 h-full overflow-hidden">
        {selectedTicket ? (
          <>
            {/* Header */}
            <div className="flex-shrink-0 h-14 border-b bg-white px-4 flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-full bg-green-500 flex items-center justify-center text-white font-bold">
                  {selectedTicket.customer_name?.[0]?.toUpperCase() || "?"}
                </div>
                <div>
                  <p className="font-medium text-sm">{selectedTicket.customer_name || selectedTicket.customer_phone}</p>
                  <p className="text-xs text-muted-foreground">{selectedTicket.customer_phone}</p>
                </div>
              </div>
              <div className="flex items-center gap-2">
                {aiIsActive && (
                  <span className="flex items-center gap-1 text-xs text-green-600 bg-green-50 px-2 py-1 rounded-full">
                    <Bot className="w-3 h-3" />
                    IA ativa
                  </span>
                )}
                {selectedTicket.intent === "sales" && (
                  <span className="flex items-center gap-1 text-xs bg-green-100 text-green-700 px-2 py-1 rounded-full">
                    <TrendingUp className="w-3 h-3" />
                    Modo Vendas
                  </span>
                )}
                {selectedTicket.intent === "support" && (
                  <span className="flex items-center gap-1 text-xs bg-blue-100 text-blue-700 px-2 py-1 rounded-full">
                    <Headphones className="w-3 h-3" />
                    Modo Suporte
                  </span>
                )}
                {(selectedTicket.intent === "unclear" || !selectedTicket.intent) && (
                  <span className="flex items-center gap-1 text-xs bg-gray-100 text-gray-600 px-2 py-1 rounded-full">
                    <HelpCircle className="w-3 h-3" />
                    Identificando
                  </span>
                )}
                <span className={`text-xs px-2 py-1 rounded-full ${
                  selectedTicket.sentiment === "positive" ? "bg-green-100 text-green-700" :
                  selectedTicket.sentiment === "frustrated" ? "bg-yellow-100 text-yellow-700" :
                  selectedTicket.sentiment === "angry" ? "bg-red-100 text-red-700" :
                  "bg-gray-100 text-gray-600"
                }`}>
                  {selectedTicket.sentiment === "positive" ? "😊 Satisfeito" :
                   selectedTicket.sentiment === "frustrated" ? "😤 Frustrado" :
                   selectedTicket.sentiment === "angry" ? "😡 Furioso" : "😐 Neutro"}
                </span>
                <button onClick={toggleTicketStatus} className="text-xs px-3 py-1 rounded border hover:bg-muted transition-colors">
                  {selectedTicket.status === "open" ? "Fechar" : "Reabrir"}
                </button>
                <button
                  onClick={copyChat}
                  disabled={messages.length === 0}
                  title="Copiar conversa"
                  className="w-8 h-8 rounded flex items-center justify-center hover:bg-muted transition-colors disabled:opacity-50"
                >
                  <Copy className="w-4 h-4 text-muted-foreground" />
                </button>
              </div>
            </div>

            {/* Messages — min-h-0 garante que o flex-1 respeite overflow */}
            <div
              
              className="flex-1 overflow-y-auto p-4 space-y-3 min-h-0"
              style={{
                backgroundColor: "#efeae2",
                backgroundImage: `url("data:image/svg+xml,%3Csvg width='60' height='60' viewBox='0 0 60 60' xmlns='http://www.w3.org/2000/svg'%3E%3Cg fill='none' fill-rule='evenodd'%3E%3Cg fill='%23d4c5a9' fill-opacity='0.3'%3E%3Cpath d='M36 34v-4h-2v4h-4v2h4v4h2v-4h4v-2h-4zm0-30V0h-2v4h-4v2h4v4h2V6h4V4h-4zM6 34v-4H4v4H0v2h4v4h2v-4h4v-2H6zM6 4V0H4v4H0v2h4v4h2V6h4V4H6z'/%3E%3C/g%3E%3C/g%3E%3C/svg%3E")`
              }}
            >
              <div className="max-w-2xl mx-auto space-y-3">
                {messages.map((msg, idx) => {
                  const msgDate = msg.created_at ? new Date(msg.created_at) : null;
                  const prevDate = idx > 0 && messages[idx - 1].created_at ? new Date(messages[idx - 1].created_at!) : null;
                  const isNewDay = msgDate && (!prevDate || !isSameDay(msgDate, prevDate));

                  return (
                    <div key={msg.id}>
                      {isNewDay && msgDate && (
                        <div className="flex items-center justify-center my-2">
                          <span className="text-xs bg-white/80 text-gray-500 px-3 py-1 rounded-full shadow-sm">
                            {isToday(msgDate) ? "Hoje" : format(msgDate, "dd/MM/yyyy")}
                          </span>
                        </div>
                      )}

                      {msg.direction === "inbound" ? (
                        <div className="flex items-end gap-2 justify-start">
                          <div className="w-8 h-8 rounded-full bg-gray-300 flex items-center justify-center text-xs font-bold flex-shrink-0">
                            {selectedTicket.customer_name?.[0]?.toUpperCase() || "?"}
                          </div>
                          <div className="max-w-[70%]">
                            <div className="bg-white border border-gray-200 rounded-2xl rounded-tl-none px-4 py-2 shadow-sm">
                              {msg.message_type === "image" && msg.media_url && (
                                <img src={msg.media_url} alt="Imagem" className="rounded mb-1 max-w-full" />
                              )}
                              {msg.message_type === "audio" && msg.media_url && (
                                <audio controls src={msg.media_url} className="max-w-full" />
                              )}
                              {msg.content && <p className="text-sm text-gray-800 whitespace-pre-wrap">{msg.content}</p>}
                            </div>
                            <span className="text-xs text-gray-400 mt-1 ml-1">
                              {msg.created_at && format(new Date(msg.created_at), "HH:mm")}
                            </span>
                          </div>
                        </div>
                      ) : (
                        <div className="flex items-end gap-2 justify-end">
                          <div className="max-w-[70%]">
                            <div className="bg-[#dcf8c6] rounded-2xl rounded-tr-none px-4 py-2 shadow-sm">
                              {msg.message_type === "image" && msg.media_url && (
                                <img src={msg.media_url} alt="Imagem" className="rounded mb-1 max-w-full" />
                              )}
                              {msg.message_type === "audio" && msg.media_url && (
                                <audio controls src={msg.media_url} className="max-w-full" />
                              )}
                              {msg.content && <p className="text-sm text-gray-800 whitespace-pre-wrap">{msg.content}</p>}
                            </div>
                            <div className="flex items-center justify-end gap-1 mt-1 mr-1">
                              <span className="text-xs text-gray-400">
                                {msg.created_at && format(new Date(msg.created_at), "HH:mm")}
                              </span>
                              <CheckCheck className="w-3 h-3 text-blue-500" />
                            </div>
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })}
                <div ref={messagesEndRef} />
              </div>
            </div>

            {/* Input */}
            <div className="flex-shrink-0 p-3 bg-[#f0f2f5] border-t flex items-end gap-2">
              <textarea
                value={newMessage}
                onChange={(e) => setNewMessage(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    handleSend();
                  }
                }}
                placeholder="Digite uma mensagem..."
                rows={1}
                className="flex-1 resize-none rounded-3xl px-4 py-2 text-sm bg-white border-0 outline-none focus:ring-0 max-h-32 overflow-y-auto"
                style={{ minHeight: "40px" }}
              />
              <button
                onClick={handleSend}
                disabled={!newMessage.trim() || sending}
                className="w-10 h-10 rounded-full bg-green-500 hover:bg-green-600 disabled:opacity-50 flex items-center justify-center flex-shrink-0"
              >
                {sending
                  ? <Loader2 className="w-4 h-4 text-white animate-spin" />
                  : <Send className="w-4 h-4 text-white" />
                }
              </button>
              <button
                onClick={handleGenerateAiReply}
                disabled={isGenerating}
                title="Gerar resposta com IA"
                className="w-10 h-10 rounded-full bg-blue-500 hover:bg-blue-600 disabled:opacity-50 flex items-center justify-center flex-shrink-0"
              >
                {isGenerating
                  ? <Loader2 className="w-4 h-4 text-white animate-spin" />
                  : <Bot className="w-4 h-4 text-white" />
                }
              </button>
            </div>
          </>
        ) : (
          <div className="flex-1 flex items-center justify-center text-muted-foreground">
            <div className="text-center">
              <MessageCircleIcon className="h-16 w-16 mx-auto mb-4 opacity-20" />
              <p>Selecione um ticket para ver a conversa</p>
            </div>
          </div>
        )}
      </div>

      {/* Customer Info Panel */}
      {selectedTicket && (
        <div className="w-72 flex-shrink-0 border-l bg-card p-4 hidden lg:flex flex-col h-full overflow-y-auto">
          <div className="text-center mb-4">
            <Avatar className="h-16 w-16 mx-auto mb-2">
              <AvatarFallback className="bg-primary/10 text-primary text-xl font-semibold">
                {(selectedTicket.customer_name || selectedTicket.customer_phone).charAt(0).toUpperCase()}
              </AvatarFallback>
            </Avatar>
            <h3 className="font-semibold">{selectedTicket.customer_name || "Sem nome"}</h3>
            <p className="text-sm text-muted-foreground flex items-center justify-center gap-1">
              <Phone className="h-3 w-3" /> {selectedTicket.customer_phone}
            </p>
          </div>

          <div className="space-y-3 mb-6">
            <div className="flex items-center justify-between text-sm">
              <span className="text-muted-foreground">Sentimento</span>
              <span>{sentimentEmoji[selectedTicket.sentiment || "neutral"]} {selectedTicket.sentiment || "neutral"}</span>
            </div>
            <div className="flex items-center justify-between text-sm">
              <span className="text-muted-foreground">Status</span>
              <Badge variant={selectedTicket.status === "open" ? "default" : "secondary"} className="text-xs">
                {selectedTicket.status}
              </Badge>
            </div>
            <div className="flex items-center justify-between text-sm">
              <span className="text-muted-foreground">Criado em</span>
              <span>{selectedTicket.created_at && format(new Date(selectedTicket.created_at), "dd/MM/yyyy")}</span>
            </div>
          </div>

          {/* Customer Memory */}
          <div className="border-t pt-4 space-y-3">
            <h4 className="font-semibold text-sm flex items-center gap-1.5">
              <MessageSquare className="h-4 w-4" /> Memória do Cliente
            </h4>
            {customerMemory ? (
              <>
                <div className="flex items-center justify-between text-sm">
                  <span className="text-muted-foreground">Interações</span>
                  <span className="font-medium">{customerMemory.total_interactions || 0}</span>
                </div>
                <div className="flex items-center justify-between text-sm">
                  <span className="text-muted-foreground">Último sentimento</span>
                  <span>{sentimentEmoji[customerMemory.last_sentiment || "neutral"]} {customerMemory.last_sentiment || "neutral"}</span>
                </div>
                <div className="flex items-center justify-between text-sm">
                  <span className="text-muted-foreground flex items-center gap-1"><Globe className="h-3 w-3" /> Idioma</span>
                  <span>{customerMemory.preferred_language || "Português"}</span>
                </div>
                {customerMemory.notes && (
                  <div className="text-sm">
                    <span className="text-muted-foreground flex items-center gap-1 mb-1"><StickyNote className="h-3 w-3" /> Notas</span>
                    <p className="text-xs bg-muted p-2 rounded">{customerMemory.notes}</p>
                  </div>
                )}
              </>
            ) : (
              <p className="text-xs text-muted-foreground">Nenhuma memória registrada ainda.</p>
            )}
          </div>

          {/* Shopify Orders */}
          <div className="border-t pt-4 space-y-3">
            <h4 className="font-semibold text-sm flex items-center gap-1.5">
              <ShoppingBag className="h-4 w-4" /> Pedidos Shopify
            </h4>
            {shopifyLoading ? (
              <div className="flex items-center justify-center py-4">
                <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
              </div>
            ) : shopifyError === "not_configured" ? (
              <p className="text-xs text-muted-foreground">Shopify não configurada nas Configurações.</p>
            ) : shopifyError ? (
              <p className="text-xs text-destructive">Erro ao buscar pedidos.</p>
            ) : shopifyOrders.length === 0 ? (
              <p className="text-xs text-muted-foreground">Nenhum pedido encontrado para este telefone.</p>
            ) : (
              <div className="space-y-2">
                {shopifyCustomer && (
                  <p className="text-xs text-muted-foreground">Cliente: {shopifyCustomer.name}</p>
                )}
                {shopifyOrders.map((order, i) => (
                  <div key={i} className="rounded border bg-muted/30 p-2 space-y-1">
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-medium">{order.order_number}</span>
                      <span className="text-xs font-medium">
                        {order.currency} {parseFloat(order.total_price).toFixed(2)}
                      </span>
                    </div>
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className={`text-[10px] px-1.5 py-0.5 rounded ${
                        order.financial_status === "PAID" ? "bg-green-100 text-green-700" :
                        order.financial_status === "REFUNDED" ? "bg-red-100 text-red-700" :
                        "bg-yellow-100 text-yellow-700"
                      }`}>
                        {order.financial_status}
                      </span>
                      <span className={`text-[10px] px-1.5 py-0.5 rounded ${
                        order.fulfillment_status === "FULFILLED" ? "bg-green-100 text-green-700" :
                        order.fulfillment_status === "UNFULFILLED" ? "bg-orange-100 text-orange-700" :
                        "bg-muted text-muted-foreground"
                      }`}>
                        {order.fulfillment_status || "UNFULFILLED"}
                      </span>
                    </div>
                    {(order.line_items || []).slice(0, 3).map((item, j) => (
                      <p key={j} className="text-[10px] text-muted-foreground truncate">
                        {item.quantity}x {item.title}{item.variant ? ` (${item.variant})` : ""}
                      </p>
                    ))}
                    {order.tracking_number && (
                      <div className="flex items-center gap-1 text-[10px]">
                        <Package className="h-3 w-3 text-muted-foreground" />
                        {order.tracking_url ? (
                          <a href={order.tracking_url} target="_blank" rel="noopener noreferrer" className="text-primary hover:underline flex items-center gap-0.5">
                            {order.tracking_number} <ExternalLink className="h-2.5 w-2.5" />
                          </a>
                        ) : (
                          <span className="text-muted-foreground">{order.tracking_number}</span>
                        )}
                      </div>
                    )}
                    <p className="text-[10px] text-muted-foreground">
                      {new Date(order.created_at).toLocaleDateString("pt-BR")}
                    </p>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}
      {exportModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-background rounded-xl p-6 w-full max-w-sm shadow-xl border">
            <h3 className="text-lg font-semibold mb-2">Exportar Conversas</h3>
            <p className="text-sm text-muted-foreground mb-4">
              Selecione o período e baixe todas as conversas em .txt
            </p>

            <div className="space-y-2 mb-6">
              {periodOptions.map(option => (
                <label key={option.value} className="flex items-center gap-3 p-3 rounded-lg border cursor-pointer hover:bg-muted transition-colors">
                  <input
                    type="radio"
                    name="period"
                    value={option.value}
                    checked={exportPeriod === option.value}
                    onChange={() => setExportPeriod(option.value)}
                    className="accent-green-500"
                  />
                  <span className="text-sm">{option.label}</span>
                </label>
              ))}
            </div>

            <div className="flex gap-2">
              <button
                onClick={() => setExportModal(false)}
                className="flex-1 px-4 py-2 text-sm rounded-lg border hover:bg-muted"
              >
                Cancelar
              </button>
              <button
                onClick={handleExport}
                disabled={exporting}
                className="flex-1 px-4 py-2 text-sm rounded-lg bg-green-500 text-white hover:bg-green-600 disabled:opacity-50"
              >
                {exporting ? 'Exportando...' : '⬇️ Exportar'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

const MessageCircleIcon = ({ className }: { className?: string }) => (
  <svg className={className} xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
    <path d="M7.9 20A9 9 0 1 0 4 16.1L2 22Z"/>
  </svg>
);

export default TicketsPage;
