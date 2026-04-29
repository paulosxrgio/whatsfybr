# Correções: envio manual, retorno padronizado e scheduler

## Problemas identificados

**1. `send-whatsapp-reply/index.ts`** retorna apenas `{ ok: true, source }` no sucesso e `{ error }` no erro. Não devolve `zapi_message_id`, `zaapId`, `messageId` nem o body completo da Z-API. Sem `ok: false` em erros — só status HTTP 500.

**2. `src/pages/Tickets.tsx` (linhas 462-475)** — `handleSend` só checa `error` do invoke, ignora `data.ok`/`data.error`, usa `catch {}` vazio que mascara erros, e **não exibe toast de sucesso**. Resultado: usuário não sabe se foi.

**3. `whatsapp-reply-scheduler/index.ts`** — não há early-return quando `pendingMessages.length === 0`. O fluxo continua: detecta intenção, extrai fatos, chama IA. É exatamente o que aparece nos logs do ticket `e547e525` às 15:31. A causa provável: o item da fila ficou "pending" antigo (de antes da última outbound) e o filtro `gt("created_at", lastReplyAt)` retorna zero, mas o código segue.

---

## Mudanças

### 1. `supabase/functions/send-whatsapp-reply/index.ts` — retorno padronizado

Trocar todos os returns para o contrato:

**Sucesso:**
```json
{ "ok": true, "zapi_message_id": "...", "zaapId": "...", "messageId": "...", "source": "manual", "zapi_response": {...} }
```

**Erro:** (sempre HTTP 200 com `ok: false` para o invoke não disparar `error` genérico)
```json
{ "ok": false, "error": "mensagem detalhada" }
```

Validações já presentes (`!zapiRes.ok || zapiBody?.error`) ficam, mas o `throw` vira `return { ok: false, error }`. Se o body não tiver nenhum dos IDs (`zaapId`/`messageId`/`id`), também retornar `ok: false` e **não inserir em `messages`**.

### 2. `src/pages/Tickets.tsx` — `handleSend` correto

Substituir linhas 462-475:

```ts
const handleSend = async () => {
  if (!newMessage.trim() || !selectedTicket || !currentStore) return;
  setSending(true);
  const messageToSend = newMessage;
  try {
    const { data, error } = await supabase.functions.invoke("send-whatsapp-reply", {
      body: { ticket_id: selectedTicket.id, message: messageToSend, store_id: currentStore.id, source: "manual" },
    });
    if (error) {
      toast.error(`Erro ao enviar: ${error.message || "função indisponível"}`);
      return;
    }
    if (!data?.ok) {
      toast.error(data?.error || "Falha ao enviar mensagem no WhatsApp");
      return;
    }
    setNewMessage("");
    toast.success("Mensagem enviada no WhatsApp!");
  } catch (e: any) {
    toast.error(`Erro inesperado: ${e?.message || "tente novamente"}`);
  } finally {
    setSending(false);
  }
};
```

Não inserir mensagem no estado local — ela já chega via realtime depois que o backend grava.

### 3. `whatsapp-reply-scheduler/index.ts` — early-return + logs

Logo após calcular `pendingMessages` e `consolidatedInput` (após linha 124), inserir:

```ts
// Logs estruturados de diagnóstico
console.log(`[SCHEDULER:CTX] ticket=${item.ticket_id} store=${item.store_id} queue_id=${item.id} scheduled_for=${item.scheduled_for} last_outbound=${lastReplyAt} inbound_pendentes=${pendingMessages?.length || 0}`);

// Early-return: nada para responder
if (!pendingMessages || pendingMessages.length === 0) {
  console.log(`[SCHEDULER] Nenhuma mensagem nova para responder no ticket ${item.ticket_id} — marcando como done`);
  await supabase.from("auto_reply_queue").update({ status: "done" }).eq("id", item.id);
  continue;
}
```

Isso impede que detecção de intenção (linha 299), extração de fatos (linha 883) e chamada à IA aconteçam quando não há nada novo. O `wantsHuman` (linha 127) também já vira no-op porque `consolidatedInput` é vazio — mas com o early-return nem chega lá.

Adicionar também no fim do envio bem-sucedido (próximo da linha 1205, após o insert da outbound), trocar o status final para `"done"`:

```ts
await supabase.from("auto_reply_queue").update({ status: "done" }).eq("id", item.id);
```

(verificar se já não está sendo feito; se sim, manter)

---

## Detalhes técnicos

- O contrato `ok: true/false` resolve o problema de `supabase.functions.invoke` só popular `error` em HTTP 5xx — assim erros lógicos da Z-API chegam como `data.ok=false` em vez de virar exception genérica.
- O early-return cobre o cenário em que: (a) o cliente mandou msg → enfileirou; (b) a IA respondeu; (c) outro processo re-enfileirou ou a msg foi deletada/já respondida — agora o item morre limpo em vez de chamar IA à toa (gasta token e pode duplicar resposta).
- Anti-loop existente (linhas 38-57, "se outbound < 30s, adia") permanece — é complementar.
- Realtime nas tabelas `tickets` e `messages` já está ativo (memory core), então a mensagem outbound aparece sozinha no painel após o backend gravar.

---

## Arquivos alterados

- `supabase/functions/send-whatsapp-reply/index.ts` — retorno padronizado `{ ok, error?, zapi_message_id?, zaapId?, messageId?, zapi_response? }`
- `src/pages/Tickets.tsx` — `handleSend` valida `data.ok`, mostra toast de sucesso/erro real
- `supabase/functions/whatsapp-reply-scheduler/index.ts` — early-return quando 0 mensagens + logs `[SCHEDULER:CTX]` e marca queue como `done`

---

## Como testar

1. **Envio manual:** abre um ticket, manda "teste" → toast verde "Mensagem enviada no WhatsApp!" + msg aparece no chat via realtime + chega no celular do cliente.
2. **Envio com Z-API offline:** desconecta a instância no painel Z-API, manda mensagem → toast vermelho com erro detalhado (não silencioso).
3. **Scheduler sem msg nova:** força um item antigo na fila com `scheduled_for` no passado. No próximo minuto, log esperado: `[SCHEDULER] Nenhuma mensagem nova para responder no ticket X — marcando como done`. Não chama IA.
4. **Scheduler com msg nova:** cliente manda msg no WhatsApp → log `[SCHEDULER:CTX] inbound_pendentes=1` → IA gera resposta → `[Z-API MAIN] status: 200, zaapId: ...` → msg aparece no painel e no WhatsApp.

## Logs esperados (sistema OK)

```
[SCHEDULER] Processando 1 itens da fila
[SCHEDULER:CTX] ticket=xxx store=yyy queue_id=zzz scheduled_for=... last_outbound=... inbound_pendentes=2
Processando 2 mensagens consolidadas para ticket xxx
Intenção detectada: support para ticket xxx
[Z-API MAIN] status: 200, zaapId: 019..., error: undefined
```

Para envio manual:
```
[Z-API RESPONSE] status: 200, body: {"zaapId":"...","messageId":"..."}
[TRAINING] novo exemplo salvo para loja xxx
```
