import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useStore } from "@/contexts/StoreContext";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { format } from "date-fns";
import { ClipboardList } from "lucide-react";

type Request = {
  id: string;
  customer_name: string | null;
  customer_phone: string | null;
  type: string | null;
  description: string | null;
  status: string | null;
  created_at: string | null;
};

const RequestsPage = () => {
  const { currentStore } = useStore();
  const [requests, setRequests] = useState<Request[]>([]);

  useEffect(() => {
    if (!currentStore) return;
    supabase
      .from("requests")
      .select("*")
      .eq("store_id", currentStore.id)
      .order("created_at", { ascending: false })
      .then(({ data }) => {
        if (data) setRequests(data);
      });
  }, [currentStore]);

  return (
    <div className="p-6 space-y-4 overflow-auto h-full">
      <h1 className="text-2xl font-bold flex items-center gap-2">
        <ClipboardList className="h-6 w-6 text-primary" /> Solicitações
      </h1>

      {requests.length === 0 ? (
        <p className="text-muted-foreground">Nenhuma solicitação encontrada.</p>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Cliente</TableHead>
              <TableHead>Telefone</TableHead>
              <TableHead>Tipo</TableHead>
              <TableHead>Descrição</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Data</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {requests.map((r) => (
              <TableRow key={r.id}>
                <TableCell>{r.customer_name || "—"}</TableCell>
                <TableCell className="font-mono text-xs">{r.customer_phone}</TableCell>
                <TableCell><Badge variant="outline">{r.type || "—"}</Badge></TableCell>
                <TableCell className="max-w-xs truncate">{r.description || "—"}</TableCell>
                <TableCell>
                  <Badge variant={r.status === "pending" ? "default" : "secondary"}>{r.status}</Badge>
                </TableCell>
                <TableCell className="text-xs">{r.created_at && format(new Date(r.created_at), "dd/MM/yyyy HH:mm")}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </div>
  );
};

export default RequestsPage;
