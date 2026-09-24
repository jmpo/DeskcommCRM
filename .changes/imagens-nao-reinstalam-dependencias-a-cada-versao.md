---
impacto: nada_mudou
secao: alterado
titulo: A construção das imagens não reinstala as dependências só porque o número da versão mudou
---

As quatro imagens declaravam o número da versão antes das etapas mais demoradas da construção, e isso fazia o Docker refazer essas etapas em toda versão nova: no worker e no agente de voz, a instalação inteira das dependências; no app e no scheduler, a instalação dos pacotes do sistema. Agora o número entra no fim, e essas etapas são reaproveitadas de uma versão para a outra. Nada muda no que a imagem contém nem no que quem opera precisa fazer. Contribuição de @bonito-system (#1569).
