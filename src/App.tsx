import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Route, Routes, Navigate } from "react-router-dom";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { AuthProvider, useAuth } from "@/contexts/AuthContext";
import { StoreProvider } from "@/contexts/StoreContext";
import { AppLayout } from "@/components/AppLayout";
import Auth from "./pages/Auth";
import TicketsPage from "./pages/Tickets";
import SettingsPage from "./pages/Settings";
import AIAgentPage from "./pages/AIAgent";
import RequestsPage from "./pages/Requests";
import AnalyticsPage from "./pages/Analytics";
import AccountSettingsPage from "./pages/AccountSettings";
import NotFound from "./pages/NotFound";

const queryClient = new QueryClient();

const ProtectedRoutes = () => {
  const { user, loading } = useAuth();

  if (loading) return <div className="flex items-center justify-center min-h-screen"><div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary" /></div>;
  if (!user) return <Auth />;

  return (
    <StoreProvider>
      <Routes>
        <Route element={<AppLayout />}>
          <Route path="/tickets" element={<TicketsPage />} />
          <Route path="/settings" element={<SettingsPage />} />
          <Route path="/ai-agent" element={<AIAgentPage />} />
          <Route path="/requests" element={<RequestsPage />} />
          <Route path="/analytics" element={<AnalyticsPage />} />
          <Route path="/" element={<Navigate to="/tickets" replace />} />
        </Route>
        <Route path="*" element={<NotFound />} />
      </Routes>
    </StoreProvider>
  );
};

const App = () => (
  <QueryClientProvider client={queryClient}>
    <TooltipProvider>
      <Toaster />
      <Sonner />
      <BrowserRouter>
        <AuthProvider>
          <ProtectedRoutes />
        </AuthProvider>
      </BrowserRouter>
    </TooltipProvider>
  </QueryClientProvider>
);

export default App;
