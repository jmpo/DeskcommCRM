---
impacto: nada_mudou
secao: corrigido
titulo: A reconciliação do Vitest ensina a checar Failed Suites antes de alertar sonda cega
---

Documentação interna em `CLAUDE.md`, para quem desenvolve: o Vitest imprime erros de coleta de arquivo e timeouts de hooks na seção dedicada `Failed Suites`, que soma linhas `FAIL` sem aparecer no rodapé `Tests N failed`.

A doutrina agora ensina a ler `Failed Suites` no log antes de sugerir re-rodar a suíte com `--reporter=verbose`. Nada muda para quem opera uma instalação.

Contribuição de @webtecnica.
