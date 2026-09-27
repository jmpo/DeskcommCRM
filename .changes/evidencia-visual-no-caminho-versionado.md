---
impacto: nada_mudou
secao: corrigido
titulo: A prova de tela passa a ser versionada junto com o repositório
---

A documentação de QA mandava gravar a evidência visual (screenshots e traces de
Playwright) numa pasta que o `.gitignore` ignorava. A prova ficava só no
computador de quem rodou o teste: quem clonasse o repositório recebia o mapa de
jornadas apontando para imagens que não existiam, e nenhuma imagem aparecia.

Agora as specs gravam na pasta `evidence/`, que é versionada — quem clona recebe
a prova. Um teste novo impede que a documentação volte a mandar gravar fora do
versionamento.

Nada muda para quem opera a VPS: nenhuma tela, nenhum dado e nenhuma variável de
ambiente foi tocada.

Contribuição de @webtecnica (#533).
