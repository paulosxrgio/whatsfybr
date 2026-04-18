
Vou atualizar o bloco "REEMBOLSO" do system prompt da Sophia em 3 lugares onde ele aparece:

1. `supabase/functions/whatsapp-reply-scheduler/index.ts` — `baseSystemPrompt` (usado em produção pela IA)
2. `src/pages/AIAgent.tsx` — `getDefaultPrompt` (prompt padrão exibido na UI)
3. `src/pages/Settings.tsx` — prompt padrão (se houver bloco equivalente)

Substituir o bloco atual de REEMBOLSO pelo novo texto fornecido pelo usuário, mantendo o formato visual (separadores ━) e a posição na hierarquia do prompt. Nenhuma outra seção será alterada.

Importante: o prompt salvo no banco (`settings.ai_system_prompt`) de lojas existentes NÃO será sobrescrito — só o template padrão muda. O usuário precisará clicar "Salvar" na página Agente IA para aplicar o novo prompt à loja, ou pedir explicitamente para rodar um UPDATE no banco.

Plano:
- Editar `whatsapp-reply-scheduler/index.ts`: localizar bloco "REEMBOLSO" no `baseSystemPrompt` e substituir.
- Editar `AIAgent.tsx`: substituir bloco REEMBOLSO no `getDefaultPrompt`.
- Editar `Settings.tsx`: substituir bloco REEMBOLSO se existir.
- Avisar o usuário que precisa salvar o prompt na UI (ou pedir migration) para aplicar à loja em produção.
