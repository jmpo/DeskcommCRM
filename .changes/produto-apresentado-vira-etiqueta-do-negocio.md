---
impacto: capacidade_nova
secao: adicionado
titulo: O produto que o assistente apresentou com as fotos do catálogo vira etiqueta do negócio
---

Quando o assistente envia uma mensagem com as fotos de um produto do catálogo e
o canal confirma o envio, o negócio aberto do contato ganha uma etiqueta com o
código do produto, em minúsculas (por exemplo, `parasol-auto-01`). Assim o fluxo
de acompanhamento pode escolher o modelo aprovado do produto certo com uma
condição de etiqueta, sem depender de o assistente lembrar de etiquetar.

A etiqueta não se repete, não entra em teste pela tela nem em mensagem que não
saiu, e só é posta quando o contato tem exatamente um negócio aberto. Fica
registrada na linha do tempo do negócio e emite o mesmo evento de "negócio
ganhou uma etiqueta" que webhooks e automações já escutam.
