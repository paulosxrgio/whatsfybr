import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useStore } from "@/contexts/StoreContext";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Send, Bot, Search, Phone, User } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { format } from "date-fns";

type Ticket = {
  id: string;
  store_id: string;
  customer_name: string | null;
  customer_phone: string;
  status: string | null;
  sentiment: string | null;
  last_message_at: string | null;
  created_at: string | null;
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

  useEffect(() => {
    if (!currentStore) return;
    const fetchTickets = async () => {
      let query = supabase
        .from("tickets")
        .select("*")
        .eq("store_id", currentStore.id)
        .order("last_message_at", { ascending: false });

      if (filter === "open") query = query.eq("status", "open");
      if (filter === "closed") query = query.eq("status", "closed");

      const { data } = await query;
      if (data) setTickets(data);
    };
    fetchTickets();

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

  const filteredTickets = tickets.filter((t) => {
    if (!search) return true;
    return (
      t.customer_name?.toLowerCase().includes(search.toLowerCase()) ||
      t.customer_phone.includes(search)
    );
  });

  return (
    <div className="flex h-full">
      {/* Ticket List */}
      <div className="w-80 border-r flex flex-col bg-card">
        <div className="p-3 space-y-2 border-b">
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
        </div>
        <ScrollArea className="flex-1">
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
                  <span className="text-sm">{sentimentEmoji[ticket.sentiment || "neutral"] || "😐"}</span>
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
      <div className="flex-1 flex flex-col min-w-0">
        {selectedTicket ? (
          <>
            <div className="p-3 border-b flex items-center gap-3 bg-card">
              <Avatar className="h-9 w-9">
                <AvatarFallback className="bg-primary/10 text-primary text-sm font-semibold">
                  {(selectedTicket.customer_name || selectedTicket.customer_phone).charAt(0).toUpperCase()}
                </AvatarFallback>
              </Avatar>
              <div>
                <p className="font-medium text-sm">{selectedTicket.customer_name || selectedTicket.customer_phone}</p>
                <p className="text-xs text-muted-foreground">{selectedTicket.customer_phone}</p>
              </div>
              <div className="ml-auto">
                <Badge variant={selectedTicket.status === "open" ? "default" : "secondary"}>
                  {selectedTicket.status === "open" ? "Aberto" : "Fechado"}
                </Badge>
              </div>
            </div>
            <ScrollArea className="flex-1 p-4" style={{ background: "hsl(var(--whatsapp-bg))" }}>
              <div className="space-y-2 max-w-2xl mx-auto">
                {messages.map((msg) => (
                  <div
                    key={msg.id}
                    className={cn(
                      "flex",
                      msg.direction === "outbound" ? "justify-end" : "justify-start"
                    )}
                  >
                    <div
                      className={cn(
                        "max-w-[70%] rounded-lg px-3 py-2 text-sm shadow-sm",
                        msg.direction === "outbound"
                          ? "bg-[hsl(var(--whatsapp-outbound))] text-foreground"
                          : "bg-[hsl(var(--whatsapp-inbound))] text-foreground"
                      )}
                    >
                      {msg.message_type === "image" && msg.media_url && (
                        <img src={msg.media_url} alt="Imagem" className="rounded mb-1 max-w-full" />
                      )}
                      {msg.message_type === "audio" && msg.media_url && (
                        <audio controls src={msg.media_url} className="max-w-full" />
                      )}
                      {msg.content && <p className="whitespace-pre-wrap">{msg.content}</p>}
                      <p className="text-[10px] text-muted-foreground mt-1 text-right">
                        {msg.created_at && format(new Date(msg.created_at), "HH:mm")}
                      </p>
                    </div>
                  </div>
                ))}
              </div>
            </ScrollArea>
            <div className="p-3 border-t bg-card flex gap-2">
              <Input
                placeholder="Digite sua mensagem..."
                value={newMessage}
                onChange={(e) => setNewMessage(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && !e.shiftKey && handleSend()}
                className="flex-1"
              />
              <Button variant="ghost" size="icon" title="Gerar Resposta IA">
                <Bot className="h-4 w-4" />
              </Button>
              <Button size="icon" onClick={handleSend} disabled={sending || !newMessage.trim()}>
                <Send className="h-4 w-4" />
              </Button>
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
        <div className="w-72 border-l bg-card p-4 hidden lg:block">
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
          <div className="space-y-3">
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
