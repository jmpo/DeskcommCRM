---
impacto: capacidade_nova
secao: adicionado
titulo: A transcrição de áudio aceita idioma declarado e modelo melhor sem copiar a chave
---

Quem atende em espanhol ou português pode declarar o idioma dos áudios em
`TRANSCRIPTION_LANGUAGES` (por exemplo `es`) e trocar o modelo em
`TRANSCRIPTION_MODEL` (por exemplo `gpt-transcribe`), usando a mesma chave da
OpenAI já cadastrada na organização — antes, trocar o modelo exigia copiar a
chave para o `.env`. Sem essas variáveis, nada muda.

O motivo é medido: com o padrão, um áudio sem fala virava "Thanks for
watching!", um cliente cancelando virava uma frase em grego e "ya es caro"
virava "ya es claro" — e o assistente respondia ao que leu. Com o idioma
declarado e `gpt-transcribe`, os três saem certos e o áudio sem fala sai vazio.
A tela de Provedores passa a mostrar o modelo de transcrição que está em uso.
