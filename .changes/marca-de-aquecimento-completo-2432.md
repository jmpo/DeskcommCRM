---
impacto: nada_mudou
secao: corrigido
titulo: A marca de aquecimento completo de cada número passa a ser gravada, e pela mesma régua do controle de ritmo
---

Cada número de WhatsApp tem uma marca de "aquecimento completo", exposta na lista de conexões da API (`is_warmup_complete`). Até aqui ela era sempre "não", em toda instalação: o início do aquecimento nunca era gravado, e sem ele a conclusão não acontecia. Agora a primeira conexão do número grava o início (numa instalação existente, é a primeira conexão depois da atualização, inclusive em números usados há meses), e a marca vira "sim" quando o controle de ritmo de envio já não põe limite de aquecimento nele — a data em "Este número é usado desde" já passou do último degrau, ou "pular o aquecimento" está ligado. Uma reconexão no mesmo dia não marca mais um número novo como aquecido.

A marca anda quando o número informa que está conectado; um número que fica conectado sem reconectar recebe a marca com atraso, para o lado seguro. Depois de marcada, ela não volta: se "pular o aquecimento" for desligado ou a data em "Este número é usado desde" for trocada por uma mais recente, a marca continua "sim" enquanto o controle de ritmo volta a limitar. Por isso nada muda no envio: o limite de mensagens por dia continua vindo do controle de ritmo. Nenhuma configuração nova, nenhum passo manual.

Contribuição de @webtecnica (#2672), a partir da issue #2432.
