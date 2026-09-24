---
impacto: nada_mudou
secao: alterado
titulo: A atualização deixa o domínio fora do ar por segundos, não por meio minuto
---

Durante uma atualização, o domínio respondia "404 page not found" por 30 a 45
segundos, mesmo com o sistema já pronto: a checagem de saúde que libera o
tráfego só rodava a cada 30 segundos. Enquanto o sistema sobe, ela passa a rodar
a cada 2 segundos, e a janela cai para poucos segundos. Requer Docker 25 ou mais
novo no servidor.
