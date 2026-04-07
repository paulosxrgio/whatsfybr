import { useStore } from "@/contexts/StoreContext";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { Plus } from "lucide-react";
import { useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { useAuth } from "@/contexts/AuthContext";

export const StoreSwitcher = () => {
  const { stores, currentStore, setCurrentStore, refetchStores } = useStore();
  const { user } = useAuth();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [creating, setCreating] = useState(false);

  const handleCreate = async () => {
    if (!name.trim() || !user) return;
    setCreating(true);
    const { error } = await supabase.from("stores").insert({ name: name.trim(), user_id: user.id });
    if (error) {
      toast.error("Erro ao criar loja");
    } else {
      toast.success("Loja criada!");
      setName("");
      setOpen(false);
      await refetchStores();
    }
    setCreating(false);
  };

  if (stores.length === 0) {
    return (
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogTrigger asChild>
          <Button variant="outline" size="sm" className="w-full gap-2">
            <Plus className="h-4 w-4" /> Criar loja
          </Button>
        </DialogTrigger>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Criar nova loja</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <Input placeholder="Nome da loja" value={name} onChange={(e) => setName(e.target.value)} />
            <Button onClick={handleCreate} disabled={creating} className="w-full">
              {creating ? "Criando..." : "Criar"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    );
  }

  return (
    <div className="flex items-center gap-2">
      <Select
        value={currentStore?.id || ""}
        onValueChange={(v) => {
          const s = stores.find((s) => s.id === v);
          if (s) setCurrentStore(s);
        }}
      >
        <SelectTrigger className="w-full">
          <SelectValue placeholder="Selecione a loja" />
        </SelectTrigger>
        <SelectContent>
          {stores.map((s) => (
            <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>
          ))}
        </SelectContent>
      </Select>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogTrigger asChild>
          <Button variant="ghost" size="icon"><Plus className="h-4 w-4" /></Button>
        </DialogTrigger>
        <DialogContent>
          <DialogHeader><DialogTitle>Criar nova loja</DialogTitle></DialogHeader>
          <div className="space-y-4">
            <Input placeholder="Nome da loja" value={name} onChange={(e) => setName(e.target.value)} />
            <Button onClick={handleCreate} disabled={creating} className="w-full">
              {creating ? "Criando..." : "Criar"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
};
