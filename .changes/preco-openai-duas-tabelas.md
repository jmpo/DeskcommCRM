---
impacto: nada_mudou
secao: corrigido
titulo: O preço dos modelos OpenAI nas duas tabelas do schema passa a bater com a fonte
---

Quem atendia com gpt-5.6-sol via a tela um preço e a conta somava outro: o catalogo (ai_models) e a tabela de orcamento (ai_pricing) seguiam com 500/3000 centavos por milhao, a versao nao promocional, enquanto o codigo que grava o custo em llm_calls cobrava 400/2000 — preco promocional medido na fonte oficial em 23/09/2026, validade declarada pela propria pagina ate 21/11/2026. As duas tabelas agora mudam juntas, a notes da linha grava fonte e data da medicao, e entram na tabela os tres ids OpenAI que o codigo ja cobrava e a tabela nao conhecia (gpt-4o, gpt-4o-mini, gpt-4o-2024-05-13). Nao ha acao para quem opera a VPS: a correcao chega na proxima atualizacao.

Contribuição de @webtecnica (#1498).
