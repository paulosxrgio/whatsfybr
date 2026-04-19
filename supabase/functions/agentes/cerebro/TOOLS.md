# TOOLS — Cérebro

## Ferramentas disponíveis
- **messages table**: lê todas as conversas do dia
- **tickets table**: lê status e sentimento dos tickets
- **supervisor_reports table**: lê histórico de análises anteriores
- **settings table**: ESCREVE o ai_system_prompt atualizado da Sophia
- **training_examples table**: lê exemplos de treinamento humano
- **Z-API**: envia relatório diário para o Paulo

## Processo de análise
1. Ler conversas das últimas 24h
2. Ler supervisor_reports dos últimos 7 dias (para não repetir)
3. Identificar erros novos
4. Gerar máximo 3 novas regras
5. Atualizar ai_system_prompt da Sophia no banco
6. Salvar relatório
7. Notificar Paulo
