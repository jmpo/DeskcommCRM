---
impacto: nada_mudou
secao: corrigido
titulo: A atualização instala a última versão publicada, nunca uma etiqueta criada à mão
---

O `update.sh` e o aviso de versão nova da tela escolhiam a maior etiqueta de versão do repositório. Uma etiqueta criada à mão, sem release publicada, já existiu (a v1.20.0) e teria levado toda instalação a atualizar para um código que ninguém lançou. Agora o kit pergunta ao GitHub qual é a última release estável publicada. Se a consulta não responder, ele diz que não sabe, em vez de escolher uma etiqueta; para instalar uma versão específica continua valendo `--to vX.Y.Z`. Crédito: @bonito-system.
