

# Correção de Tickets Duplicados

## Overview
Duas mudanças: corrigir a lógica de busca/criação de ticket no edge function e criar migration para consolidar duplicados existentes.

## Changes

### 1. `supabase/functions/process-inbound-whatsapp/index.ts` (lines 90-122)
Replace the ticket find/create block:
- Use `select('id, customer_name')` instead of `select('*')`
- Extract `ticketId` as a string variable
- Always update `last_message_at` and `customer_name` when reusing existing ticket (not just when name is missing)
- Include `last_message_at` in the insert for new tickets
- Return 500 on insert failure instead of throwing
- Remove the separate `last_message_at` update call below (line ~122) since it's now handled inline

### 2. New migration: Close duplicate open tickets
```sql
UPDATE tickets t1
SET status = 'closed'
WHERE status = 'open'
AND id NOT IN (
  SELECT DISTINCT ON (store_id, customer_phone) id
  FROM tickets
  WHERE status = 'open'
  ORDER BY store_id, customer_phone, created_at DESC
);
```

## Files

| File | Change |
|------|--------|
| `supabase/functions/process-inbound-whatsapp/index.ts` | Refactor ticket lookup/create logic |
| New migration | Close duplicate open tickets |

