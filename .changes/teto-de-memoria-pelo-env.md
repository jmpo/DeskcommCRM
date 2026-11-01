---
impacto: capacidade_nova
secao: adicionado
titulo: O teto de memória do app, do worker e do WAHA se ajusta pelo .env
---
Quem roda o CRM numa VPS com mais memória pode subir o teto de cada contêiner sem editar o `docker-compose.prod.yml`, que a atualização regrava: basta `APP_MEM_LIMIT`, `WORKER_MEM_LIMIT` e `WAHA_MEM_LIMIT` no `.env` (por exemplo `WORKER_MEM_LIMIT=1536m` numa VPS de 8 GB). Sem essas linhas tudo fica como antes — app 768m, worker 512m, WAHA 1280m —, e não há nada a fazer na VPS.
