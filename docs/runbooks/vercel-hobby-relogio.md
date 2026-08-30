# Relógio no Vercel Hobby (follow-up não fica preso)

## Por que existe

No plano Hobby a Vercel só agenda **1 cron por dia**. Sem um relógio externo:

1. o lead responde "SIM" no WhatsApp;
2. a mensagem entra no banco (inbox OK);
3. o enrollment fica em `waiting_reply` / `cap_nome` para sempre.

O endpoint `POST /api/v1/system/relogio/tick` drena eventos, aplica respostas
inbound nos follow-ups e envia textos fixos pendentes. Quem precisa chamar
esse endpoint a cada poucos minutos é um **cron de fora** — grátis.

## Pré-requisito: um só deploy no domínio do WAHA

O webhook WAHA tem que bater no **mesmo** deployment que a UI/`webhooks/in`.

```bash
# Ver para onde o domínio aponta hoje
npx vercel alias ls | findstr /i "crm-gabrielle deskcomm-crm"

# Se ainda apontar para um deploy CLI antigo, reaponte para o da branch develop:
npx vercel alias set <url-do-deploy-develop> crm-gabrielle.vercel.app
```

Confirme nos logs: `POST /api/v1/webhooks/waha` e `POST /api/v1/webhooks/in`
devem compartilhar o **mesmo** `dep=dpl_…`.

## Opção A — GitHub Actions (grátis em repo público)

Arquivo: [`.github/workflows/relogio.yml`](../../.github/workflows/relogio.yml).

**Limitação:** o `schedule:` do Actions **só roda na branch default (`main`)**.
Se o workflow existir só em `develop`, o cron **nunca** dispara.

### Ligar

1. Mergeie `.github/workflows/relogio.yml` em `main` (ou copie o arquivo).
2. No GitHub do **seu** fork/instalação → Settings → Secrets and variables:

| Tipo | Nome | Valor |
|------|------|--------|
| Variable | `RELOGIO_LIGADO` | `1` |
| Secret | `RELOGIO_APP_URL` | `https://crm-gabrielle.vercel.app` (sem barra no fim) |
| Secret | `RELOGIO_SECRET` | o mesmo `INTERNAL_SECRET` do projeto na Vercel |

3. Actions → **relogio** → Run workflow (teste manual).
4. Espere o schedule `*/5` (o GitHub atrasa; 5–15 min é normal).

```bash
# Via CLI (com permissão de secrets no repo)
gh variable set RELOGIO_LIGADO -R SEU_USER/DeskcommCRM -b 1
gh secret set RELOGIO_APP_URL -R SEU_USER/DeskcommCRM -b "https://crm-gabrielle.vercel.app"
gh secret set RELOGIO_SECRET -R SEU_USER/DeskcommCRM -b "$INTERNAL_SECRET"
```

## Opção B — cron-job.org (grátis, a cada 1 minuto)

Melhor latência que o Actions. Conta free permite job a cada minuto.

1. Crie conta em [https://cron-job.org](https://cron-job.org).
2. Create cronjob:
   - **URL:** `https://crm-gabrielle.vercel.app/api/v1/system/relogio/tick`
   - **Schedule:** every 1 minute
   - **Request method:** POST
   - **Header:** `Authorization` = `Bearer <INTERNAL_SECRET>`
3. Enable e rode "Execute now".

O curl equivalente:

```bash
curl -fsS -X POST \
  -H "Authorization: Bearer $INTERNAL_SECRET" \
  "https://crm-gabrielle.vercel.app/api/v1/system/relogio/tick"
```

## Como saber que está funcionando

Nos logs da Vercel (produção), a cada batida:

- `POST /api/v1/system/relogio/tick` → 200
- quando há "SIM" preso: `[relogio] follow-up avancou por resposta inbound`

Na fila de follow-ups, o status sai de **Aguardando resposta**.

## O que o tick faz (ordem)

1. `event-log-drain` — consome `message.received` (reatividade do follow-up)
2. `followup-flow-worker` — aplica texto inbound + claim de enrollments + envio fixo
3. `routing-worker`
4. `recover-stuck-messages`

Definição canônica: `lib/relogio/tarefas.ts` + `lib/relogio/executar.ts`.
