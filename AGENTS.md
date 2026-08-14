# AGENTS.md — DeskcommCRM

> Contrato para **qualquer** agente de código (Codex, Cursor, Copilot, Amp, Claude Code).
> Este arquivo é o núcleo portável. A **doutrina completa e não-negociável vive em
> [`CLAUDE.md`](CLAUDE.md)** — leia-o antes de tocar em código. Aqui está o mínimo
> para não causar dano.

---

## Objetivo do projeto

Sistema operacional de vendas open source com agentes de IA nativos, multi-nicho,
WhatsApp como canal primário (via WAHA). Multi-tenant com RLS desde o dia 1, LGPD
nativa. Monetização = self-host em VPS, não assinatura. Posicionamento: [`VISION.md`](VISION.md).

**Consequência que muda como você trabalha:** o produto é distribuído como código.
Quem instala numa VPS **é** o usuário. Uma mudança que funciona na máquina do dev e
quebra no clone fresco é um bug de produto, não um detalhe de ambiente.

## Stack (CONFIRMADO em `package.json`)

Next.js 16.3 (App Router) · React 19.2 · TypeScript 6.0 estrito · Tailwind 3.4 ·
shadcn/ui · Supabase (Postgres + Auth + Realtime + Storage) · Upstash Redis ·
Vercel AI Gateway (`@ai-sdk/anthropic|openai|google`) · WAHA Plus (engine NOWEB) ·
Zod 4 · Vitest 4 · Playwright 1.62 · Sentry 10.
Runtime: **Node ≥22** (`.nvmrc` = 22; o job `ci` roda 22, mas o `perf` ainda builda em 20 —
divergência com `engines`, registrada como bug). Gerenciador: **pnpm 9.15.9** (`packageManager`).
Versão do produto: **1.0.0** (`CHANGELOG.md`, SemVer — mudança que afeta quem roda VPS entra lá).

## Estrutura que importa

| Path | O quê |
|---|---|
| `app/api/v1/` | 166 route handlers REST (versionado por path) — 169 contando `app/api/**` |
| `app/api/internal/`, `app/api/mcp/`, `app/api/v1/cron/` | superfícies não-cookie (secret/bearer próprio) |
| `app/app/` | UI autenticada do tenant · `app/admin/` UI de plataforma |
| `app/actions/` | Server Actions (auth, onboarding, team, settings) |
| `lib/agent-engine/`, `lib/ai/` | runtime do agente, guardrails, RAG, dispatcher |
| `lib/api/wrappers.ts` | `ok()` / `fail()` — **use sempre**, não monte Response na mão |
| `lib/auth/require-role.ts` | `requireRole()` — guard canônico de RBAC |
| `lib/supabase/{browser,server,admin}.ts` | clients canônicos |
| `workers/` | workers de `event_log` + crons |
| `supabase/migrations/` | schema versionado · `supabase/baseline.sql` = o que o self-host aplica |
| `proxy.ts` | middleware do Next 16 (auth de borda, `X-Request-Id`) |

## Comandos (CONFIRMADO em `package.json`)

```bash
pnpm install          # deps (frozen-lockfile no CI)
pnpm dev              # dev server
pnpm build            # next build
pnpm lint             # eslint
pnpm typecheck        # tsc --noEmit (estrito)
pnpm test:unit        # vitest — EXCLUI tests/invariants e tests/e2e
pnpm test:db          # invariantes de banco + gate do baseline (PRECISA de Docker)
pnpm test:e2e         # Playwright (PRECISA de app rodando + banco semeado)
pnpm gov:verify       # typecheck + lint + test:unit  ← verificação única atual
```

⚠️ **`pnpm gov:verify` NÃO cobre tudo.** Ele omite `test:db` e `test:e2e`. Se sua
mudança toca schema, RLS ou UI, `gov:verify` verde **não** é prova — rode `pnpm test:db`
(exige Docker) e/ou `pnpm test:e2e` você mesmo. Ver [`docs/harness-audit.md`](docs/harness-audit.md).

**O que o CI cobre.** `.github/workflows/ci.yml`: `verify` = typecheck + lint + test:unit;
`invariants` = `pnpm test:db` (isolamento RLS + invariantes de governança contra Postgres
efêmero pg17). `.github/workflows/perf.yml`: `build-and-size` = `pnpm build`.
**Os três são checks obrigatórios** na branch protection da `main`.

`.github/workflows/e2e.yml` roda **28 das 32 specs** Playwright contra um Supabase local de
verdade com o `baseline.sql` aplicado — o mesmo banco que o self-hoster tem. **Não é
obrigatório ainda** (o conjunto de specs acabou de mudar, então execuções verdes anteriores
eram de outro conjunto e não provam a estabilidade deste). As 4 de fora: `followup-journey` e
`webhooks` (precisam de WAHA), `vps-fresh-onboarding` (WAHA + Redis + Resend + Nuvemshop; é a
P0 da doutrina de QA) e `capacidades-do-agente`, que está fora porque REPROVA de verdade — ver
o summary do job. Se você mexeu em UI fora desse subconjunto, a prova é sua.

## Padrões de código (observados no repo, não inventados)

- **Route handler:** valida input com Zod → guard (`requireRole` / `requirePlatformAdmin` /
  secret) → query com `organization_id` explícito → `audit()` se mutação → `ok()` / `fail()`.
- Erro: `fail(code, message, status)` com código de `lib/api/errors.ts`. Nunca `throw` cru na borda.
- JSON **snake_case** na API. Dinheiro em `_cents` + `currency`. Datas ISO-8601 UTC.
- Log: `lib/logger.ts` (estruturado). **`console.log` é proibido** em código merged.
- Testes ao lado do código (`lib/foo/bar.test.ts`) ou em `tests/{unit,api,invariants,e2e}/`.
- Comentários em PT-BR são a norma neste repo — mantenha o idioma do arquivo que editar.

## Diretórios e arquivos SENSÍVEIS

- **`supabase/baseline.sql`** — é o que o `install.sh`/`update.sh` do self-host aplicam.
  Toda mudança de schema tem que aparecer aqui **como apêndice idempotente**, senão
  não chega em quem instalou. Ver doutrina de Migrations em `CLAUDE.md`.
- **`supabase/migrations/*.sql` já aplicadas** — nunca edite. Corrija com migration nova.
- **`lib/supabase/admin.ts`** — service role **bypassa RLS**. 89 rotas o usam; toda
  query precisa filtrar `organization_id` manualmente, resolvido de fonte confiável
  (cookie/JWT/webhook secret/path token), **nunca do body**.
- **`lib/auth/public-paths.ts`** — adicionar path aqui remove a checagem de auth de borda.
  Só com guard próprio dentro da rota.
- **`.env*`** — não abra, não copie valor, não logue. Só `.env.example` é template.
- **`docker-compose.traefik.yml`** — numa VPS que já tem proxy reverso próprio
  (Hostinger, Coolify, Dokploy…), é o único lugar que dá ao contêiner `app` as labels
  de roteamento. Todo `up -d` leva os **dois** arquivos de compose:
  `docker compose -f docker-compose.prod.yml -f docker-compose.traefik.yml --env-file .env up -d app`.
  Esquecer o segundo `-f` recria o contêiner sem labels: o proxy deixa de enxergá-lo e o
  domínio inteiro responde `404`, com o contêiner `healthy` — o healthcheck é um probe TCP
  interno e não sabe nada de roteamento. Runbook: `docs/runbooks/deploy.md`.

## Arquivos GERADOS — não editar à mão

- `lib/database.types.ts` (6.1k linhas — gerado do schema Supabase)
- `graphify-out/` (grafo de conhecimento; regenerado por `/graphify .`)
- `pnpm-lock.yaml`, `tsconfig.tsbuildinfo`, `next-env.d.ts`, `.next/`

## Como validar uma alteração

1. `pnpm typecheck` e `pnpm lint` zerados.
2. `pnpm test:unit` verde.
3. Tocou schema/RLS/tabela tenant-aware → `pnpm test:db` (sobe Postgres efêmero via Docker,
   aplica `baseline.sql` em modo install **e** update, roda os invariantes).
4. Tocou UI ou fluxo de usuário → `pnpm test:e2e` com evidência visual. **`curl` não conta**
   como prova de UX (doutrina de QA Visual em `CLAUDE.md`).
5. Mudou schema → migration versionada em `supabase/migrations/` **+** apêndice idempotente
   em `supabase/baseline.sql` **+** linha em `supabase/migrations/MANIFEST.md`. Os três juntos.
6. Criou função em `public` → `revoke execute on function ... from public, anon;` e depois
   `grant` só a quem precisa. São **duas** origens de `EXECUTE` e revogar uma só deixa a
   função exposta como RPC alcançável pela anon key. Detalhe em `CLAUDE.md`, item 9 da
   doutrina de Migrations.

## Testes existentes (CONFIRMADO)

- **221** arquivos `*.test.ts(x)` unitários (rodam em `test:unit` e no CI)
- **67** arquivos de invariante de banco em `tests/invariants/` — RLS/isolamento cross-tenant,
  RBAC, governança (G1–G6). Excluídos do `test:unit` de propósito; rodam via `pnpm test:db`
  **e no job `invariants` do CI**.
- **32** specs Playwright em `tests/e2e/`. **28 rodam no CI** (via `e2e.yml`,
  não-obrigatório). As 4 de fora dependem de serviço externo (WAHA/Redis/Resend/Nuvemshop) —
  incluindo `vps-fresh-onboarding` — ou reprovam legitimamente (`capacidades-do-agente`).
  Ver issue #63.

## Limitações conhecidas (estado em 2026-07-29, contra `origin/main` @ 789dfa6)

- **4 das 32 specs E2E seguem fora do CI**, e o `e2e` ainda não é check obrigatório: um PR
  que o quebre entra na `main` assim mesmo. Se você mexeu em UI coberta só por essas 4, a
  prova é sua.
- Rate limit HTTP existe em **2** pontos do código (webhook de captação e dispatcher de IA);
  login, signup, aceite de convite, crons e MCP estão sem. Não há lockout por conta no login.
- Fallback do rate limit é **em memória** — sem Upstash configurado o limite é por processo.
- `Idempotency-Key` implementado em **1** rota, apesar de o contrato prometer nos POSTs de criação.
- **6 vars de `lib/env.ts` faltam no `.env.example`**, incluindo 3 secrets. Se você adicionar
  env var, adicione nos dois lugares (item 9 do DoD).
- `lib/auth/invite-token.ts` cai em `"dev-fallback"` como secret HMAC se nenhum secret existir
  (inalcançável em produção, porque `INTERNAL_SECRET` é obrigatório e derruba o boot).
- **89 dos 169 handlers de `app/api/**` usam service role** — sem gate automático para o filtro de
  `organization_id`. Escrevendo handler novo, o filtro é responsabilidade sua.
- Detalhes e prioridade: [`docs/harness-audit.md`](docs/harness-audit.md),
  [`docs/current-state.md`](docs/current-state.md) e [`docs/threat-model.md`](docs/threat-model.md).

## Regras de segurança

- Sempre `getUser()` no backend. **Nunca `getSession()`** (confia no cookie sem revalidar).
- API key/token **nunca** em query string — só header. Plaintext do bearer é mostrado
  **uma vez**; no banco só hash SHA256.
- HMAC de webhook com `crypto.timingSafeEqual`. Fail-closed quando o secret falta.
- Nunca logue segredo, token, CPF, telefone ou e-mail. Sentry tem `beforeSend` que
  higieniza — não confie nele como única camada.
- Não commite screenshot/dump com dado real de cliente.

## Packaging — se você tocou `Dockerfile*`, `docker-compose*.yml` ou `hostgator-setup-kit/`

Lei completa em [`docs/doctrine/packaging.md`](docs/doctrine/packaging.md). O não-negociável:

- **Nenhum serviço de `docker-compose.prod.yml` constrói na máquina do cliente.** Todo serviço
  declara `image:` de uma imagem publicada; `build:` só existe **ao lado**, como escape.
  Serviço `build:`-only é pulado por `docker compose pull` e imune a `up -d` sem `--build` —
  ele não é só caro de instalar, ele **nunca é atualizado**.
- **Publicação é ato do CI**, nunca da sua máquina: build ARM local não roda na VPS amd64.
- **Instalação de cliente aponta para número de versão**, nunca para tag móvel. Aqui `latest`
  significa **topo da `main`**, não última release — quem quer a última release usa `stable`.
- **Dependência upstream é referenciada com tag fixa, nunca republicada** (WAHA é licenciado).
- **Bump de versão não pode exigir que o operador da VPS edite arquivo à mão.**

`pnpm test:shell` é o único gate que exercita o kit. Rode-o.

## Critério de conclusão

Vale a **Definition of Done de 15 itens em [`CLAUDE.md`](CLAUDE.md)**. Não declare pronto
sem: typecheck/lint zerados, testes relevantes verdes, RLS testada se tocou tabela
tenant-aware, migration + baseline + MANIFEST se mudou schema, prova visual se mudou UI, e a
regra de packaging acima se mudou o artefato que o self-hoster instala.

## Regra final — não invente

Este repositório tem PRDs, specs, regras de negócio e doutrina escritos
(`docs/prd/`, `docs/specs/`, `docs/business-rules/`, `docs/doctrine/`).
**Nunca invente regra de negócio, número, SLA ou comportamento de produto.**
Se a regra não está escrita, diga que não está e pergunte — não preencha a lacuna com
suposição plausível. Ao documentar, marque o que é `CONFIRMADO` (provado por código) e o
que é `INFERIDO`.
