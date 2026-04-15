

# Corrigir fetch-shopify-orders com múltiplas estratégias de busca

## O que será feito

Reescrever a Edge Function `fetch-shopify-orders` para usar duas estratégias de busca sequenciais:

1. **Estratégia 1 — customers/search**: Testa ~10 variantes de formato do telefone brasileiro (com/sem DDI, com/sem formatação) contra a API de busca de clientes Shopify
2. **Estratégia 2 — busca direta nos pedidos**: Se nenhum cliente for encontrado, busca os últimos 50 pedidos e filtra localmente pelo telefone

Também expande as variantes de telefone para incluir formatos com espaços, hífens e parênteses que o Shopify pode armazenar.

## Arquivo alterado

| Arquivo | Mudança |
|---------|---------|
| `supabase/functions/fetch-shopify-orders/index.ts` | Substituir conteúdo pela nova lógica com duas estratégias + variantes expandidas |

## Detalhes técnicos

- Variantes de telefone expandidas: `+55 14 99745-2773`, `(14) 99745-2773`, `14 99745-2773`, etc.
- Estratégia 2 usa comparação fuzzy: `includes`, `endsWith` no número sem DDI
- Logs em cada etapa para debug
- Deploy automático após edição

