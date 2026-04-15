

# Correção do Layout do Chat + Exportação de Conversa

## Problema

O chat usa `flex-1 overflow-y-auto` na area de mensagens (linha 434-435), mas o container pai (`flex h-full`) depende do `<main className="flex-1 overflow-hidden">` no AppLayout. O problema é que sem uma altura fixa definida no container, o `flex-1` pode expandir indefinidamente dependendo do conteúdo. A area de mensagens precisa de um container com scroll interno bem delimitado.

## Plano

### 1. Corrigir layout do chat (Tickets.tsx)

- Mudar o container principal de `flex h-full` para `flex h-full overflow-hidden` para garantir que nada extrapola
- Envolver a area de mensagens em um container com `min-h-0` (necessario em flex columns para que `overflow-y-auto` funcione corretamente)
- Garantir que a coluna do chat (`flex-1 flex flex-col min-w-0`) tambem tenha `min-h-0`
- O resultado: header fixo no topo, input fixo embaixo, mensagens com scroll interno no meio

### 2. Melhorias visuais

- Adicionar padding mais consistente
- Garantir que a area de scroll nao fique "solta" visualmente

### 3. Exportar conversa como imagem (Tickets.tsx)

- Instalar `html-to-image` (biblioteca leve, ~5KB)
- Adicionar botao de camera/download no header do chat
- Ao clicar: renderizar todas as mensagens em um container temporario off-screen (sem scroll, altura total) e capturar com `toPng()`
- Gerar download automatico do PNG

## Detalhes Tecnicos

**Layout fix**: A chave e adicionar `min-h-0` no flex container da coluna de chat. Em flexbox, filhos com `flex-1` nao encolhem abaixo do seu conteudo a menos que `min-height: 0` seja definido. Isso forca o `overflow-y-auto` a funcionar.

**Captura de imagem**: `html-to-image` renderiza um DOM node para canvas/PNG. Para capturar toda a conversa (nao so a parte visivel), criamos um clone temporario do container de mensagens com `overflow: visible` e `height: auto`, capturamos, e removemos.

## Arquivos

| Arquivo | Mudanca |
|---------|---------|
| `src/pages/Tickets.tsx` | Fix layout + botao exportar + logica de captura |
| `package.json` | Adicionar `html-to-image` |

