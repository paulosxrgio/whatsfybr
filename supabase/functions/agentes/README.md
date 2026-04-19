# Arquitetura de Agentes Dual

Esta pasta contém os arquivos de identidade dos agentes do sistema. Eles são lidos em runtime pelas Edge Functions para compor prompts e contexto.

## Estrutura

```
agentes/
├── sophia/        # Atendente da loja (whatsapp-reply-scheduler)
│   ├── SOUL.md
│   ├── IDENTITY.md
│   ├── MEMORY.md
│   ├── TOOLS.md
│   ├── HEARTBEAT.md
│   └── AGENTS.md
└── cerebro/       # Supervisor (supervisor-agent)
    ├── SOUL.md
    ├── IDENTITY.md
    ├── MEMORY.md
    ├── TOOLS.md
    └── AGENTS.md
```

## Hierarquia
- **Sophia** atende clientes no WhatsApp (front-line)
- **Cérebro** analisa Sophia diariamente e atualiza seu prompt (background)
- **Paulo** (humano) supervisiona o Cérebro via painel Analytics
