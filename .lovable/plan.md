
## Vision para imagens no WhatsApp

Plano para habilitar análise de imagens via GPT-4o Vision no fluxo de atendimento.

### 1. `process-inbound-whatsapp/index.ts`

Hoje o código já detecta `body.image` e extrai `mediaUrl = body.image.imageUrl`. Vou adicionar análise Vision logo após salvar a mensagem inbound, quando `messageType === 'image'`:

- Buscar `openai_api_key` em `account_settings` (mesmo padrão do bloco de áudio que já existe).
- Baixar a imagem do `mediaUrl`, converter para base64 (usando loop para evitar stack overflow do `String.fromCharCode(...)` em imagens grandes).
- Chamar `https://api.openai.com/v1/chat/completions` com modelo `gpt-4o`, `detail: 'low'`, prompt em português pedindo descrição objetiva (3 frases max).
- Atualizar o `content` da mensagem salva para `[Imagem: <descrição>]` via `supabase.from('messages').update(...).eq('id', savedMessageId)`.
- Em caso de falha: `[Imagem recebida — não foi possível analisar]`.
- Logs com prefixo `[VISION]` / `[VISION ERROR]`.

Ajustes técnicos importantes:
- O insert atual de mensagem não captura o ID retornado — preciso trocar por `.insert({...}).select('id').single()` para ter `savedMessageId`.
- Usar conversão base64 em chunks (evita "Maximum call stack" com `Uint8Array` grande):
  ```ts
  let binary = '';
  const bytes = new Uint8Array(imageBuffer);
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode.apply(null, bytes.subarray(i, i + chunkSize) as any);
  }
  const base64Image = btoa(binary);
  ```

### 2. `whatsapp-reply-scheduler/index.ts`

O scheduler já consolida mensagens inbound desde a última outbound usando `m.content`. Como agora a mensagem de imagem terá `content = "[Imagem: descrição]"`, ela entra no histórico automaticamente.

Vou apenas verificar/ajustar o ponto onde mensagens com `message_type === 'image'` eram tratadas como `'[Cliente enviou uma imagem]'` — substituir para usar `m.content` diretamente quando ele já contém a descrição (`[Imagem: ...]`), com fallback para o texto antigo se vazio.

### 3. System prompt (3 lugares)

Adicionar bloco `IMAGENS E MÍDIAS` em:
- `supabase/functions/whatsapp-reply-scheduler/index.ts` — `baseSystemPrompt`
- `src/pages/AIAgent.tsx` — `getDefaultPrompt`
- `src/pages/Settings.tsx` — prompt padrão (se existir bloco equivalente)

Bloco a adicionar:
```
━━━━━━━━━━━━━━━━━━━━━━
IMAGENS E MÍDIAS
━━━━━━━━━━━━━━━━━━━━━━
- Quando ver [Imagem: descrição], use essa descrição para responder
- Comprovante de pagamento → confirme recebimento e verifique no pedido
- Print de anúncio/produto → identifique se é da Adorisse pelo domínio adorisse.com.br
- Foto de produto recebido com problema → registre como solicitação de troca
- NUNCA diga que não consegue ver imagens — agora você consegue
```

### Observações
- Usa a `openai_api_key` da conta (já configurada e usada para Whisper). Sem custo extra de setup.
- `detail: 'low'` mantém custo baixo (~85 tokens/imagem).
- Lojas existentes precisam clicar "Salvar" no Agente IA para o novo bloco entrar em vigor (prompt salvo no banco não é sobrescrito automaticamente).

### Arquivos editados
- `supabase/functions/process-inbound-whatsapp/index.ts`
- `supabase/functions/whatsapp-reply-scheduler/index.ts`
- `src/pages/AIAgent.tsx`
- `src/pages/Settings.tsx` (se aplicável)
