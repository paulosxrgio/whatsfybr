import React, { createContext, useContext, useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";

type Store = {
  id: string;
  name: string;
  user_id: string;
  created_at: string | null;
};

type StoreContextType = {
  stores: Store[];
  currentStore: Store | null;
  setCurrentStore: (store: Store) => void;
  loading: boolean;
  refetchStores: () => Promise<void>;
};

const StoreContext = createContext<StoreContextType>({
  stores: [],
  currentStore: null,
  setCurrentStore: () => {},
  loading: true,
  refetchStores: async () => {},
});

export const useStore = () => useContext(StoreContext);

export const StoreProvider = ({ children }: { children: React.ReactNode }) => {
  const [stores, setStores] = useState<Store[]>([]);
  const [currentStore, setCurrentStore] = useState<Store | null>(null);
  const [loading, setLoading] = useState(true);

  const fetchStores = async () => {
    const { data } = await supabase.from("stores").select("*").order("created_at");
    if (data && data.length > 0) {
      const testStore = data.find((s) => s.name === "Minha Loja Teste");
      if (testStore && data.length > 1) {
        await supabase.from("stores").delete().eq("id", testStore.id);
        const filtered = data.filter((s) => s.id !== testStore.id);
        setStores(filtered);
        if (!currentStore || !filtered.find((s) => s.id === currentStore.id)) {
          setCurrentStore(filtered[0]);
        }
      } else {
        setStores(data);
        if (!currentStore || !data.find((s) => s.id === currentStore.id)) {
          setCurrentStore(data[0]);
        }
      }
    } else {
      setStores([]);
      setCurrentStore(null);
    }
    setLoading(false);
  };

  useEffect(() => {
    fetchStores();
  }, []);

  return (
    <StoreContext.Provider
      value={{ stores, currentStore, setCurrentStore, loading, refetchStores: fetchStores }}
    >
      {children}
    </StoreContext.Provider>
  );
};
