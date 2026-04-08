

# Reorganização de Configurações — Conta Global vs Loja

## Overview
Separar configurações em dois níveis: **Conta** (IA provider/keys, global) e **Loja** (Z-API, Sophia agent, Shopify). Criar tabela `account_settings`, nova página, e atualizar edge functions para buscar keys da conta.

---

## 1. Migration — Criar tabela `account_settings`

```sql
CREATE TABLE public.account_settings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL UNIQUE,
  ai_provider text DEFAULT 'openai',
  openai_api_key text,
  anthropic_api_key text,
  ai_model text DEFAULT 'gpt-4o',
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

ALTER TABLE public.account_settings ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users manage own account settings"
ON public.account_settings FOR ALL
USING (auth.uid() = user_id)
WITH CHECK (auth.uid() = user_id);
```

## 2. New page — `src/pages/AccountSettings.tsx`

Two sections:
- **Provedor de IA**: provider dropdown, API key field, model dropdown, save button
- **Dados da Conta**: user name (editable), email (read-only), save button

Fetches/upserts from `account_settings` table using `auth.uid()`.

## 3. Add route + sidebar link

- **`App.tsx`**: Add route `/account-settings` → `AccountSettingsPage`
- **`AppSidebar.tsx`**: Add `SlidersHorizontal` icon link in `SidebarFooter` before the "Sair" button

## 4. Update `Settings.tsx` — Remove AI Provider section

Remove the entire "Provedor de IA" card. Keep only: Z-API, Agente IA (toggle/delay/prompt), Shopify.

## 5. Update `AIAgent.tsx` — Remove provider/key fields

Remove provider dropdown, model dropdown, and API key input. Replace with an info card showing the configured provider/model from `account_settings`, with a link to `/account-settings`.

## 6. Update `whatsapp-reply-scheduler` Edge Function

After getting `settings` (per-store), fetch `account_settings` by the store's `user_id`:
```typescript
const { data: store } = await supabase.from("stores").select("user_id").eq("id", item.store_id).single();
const { data: acct } = await supabase.from("account_settings").select("*").eq("user_id", store.user_id).maybeSingle();
```
Use `acct.ai_provider`, `acct.openai_api_key`, `acct.ai_model` instead of `settings.*` for AI calls.

---

## Files

| File | Change |
|------|--------|
| `supabase/migrations/...` | Create `account_settings` table + RLS |
| `src/pages/AccountSettings.tsx` | New page |
| `src/App.tsx` | Add `/account-settings` route |
| `src/components/AppSidebar.tsx` | Add footer link |
| `src/pages/Settings.tsx` | Remove AI Provider card |
| `src/pages/AIAgent.tsx` | Replace provider fields with info card |
| `supabase/functions/whatsapp-reply-scheduler/index.ts` | Fetch keys from `account_settings` |

