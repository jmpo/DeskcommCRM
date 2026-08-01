#!/usr/bin/env bash
#
# DeskcommCRM — instalador self-host para VPS (HostGator).
#
# Idempotente: pode rodar de novo sem estragar nada. Dependências no host:
# só docker, docker compose, git, openssl, curl. psql/bootstrap rodam via Docker.
#
# Uso:
#   bash install.sh            # interativo (pergunta o que falta)
#   bash install.sh --yes      # não-interativo (usa .env já preenchido)
#
set -euo pipefail

# Diretório onde este script (e _common.sh, seu irmão) vivem — capturado ANTES
# de qualquer 'cd' (step 2 pode entrar num repo clonado à parte).
KIT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]:-$0}")" && pwd)"

REPO_URL="${REPO_URL:-https://github.com/melgarafael/DeskcommCRM.git}"
REPO_DIR="${REPO_DIR:-deskcommcrm}"
COMPOSE="docker-compose.prod.yml"
NONINTERACTIVE=0
[ "${1:-}" = "--yes" ] && NONINTERACTIVE=1

c_red() { printf '\033[31m%s\033[0m\n' "$*"; }
c_grn() { printf '\033[32m%s\033[0m\n' "$*"; }
c_ylw() { printf '\033[33m%s\033[0m\n' "$*"; }
c_dim() { printf '\033[2m%s\033[0m\n' "$*"; }
die()   { c_red "✖ $*"; exit 1; }
step()  { printf '\n\033[1m▶ %s\033[0m\n' "$*"; }

# ── Rede de segurança: nenhuma saída silenciosa ─────────────────────────────
# Antes, qualquer comando que falhasse sob `set -e` derrubava o script sem
# dizer nada (o caso real: um psql com connection string errada saía com
# código 2 dentro de uma substituição, e a pessoa só via o terminal voltar).
# Instalação é o primeiro contato com o produto: morrer mudo aqui é perder o
# usuário. Este trap garante que TODA saída != 0 explique o que fazer.
show_recovery() {
  local dir="${PROJECT_DIR:-$(pwd)}"
  c_red ""
  c_red "═══════════════════════════════════════════════════════"
  c_red " A instalação parou. Nada ficou pela metade sem conserto."
  c_red "═══════════════════════════════════════════════════════"
  printf '\n%s\n\n' "Como voltar atrás e recomeçar do zero:"
  printf '  %s\n' "cd ${dir}"
  printf '  %s\n' "rm -f .env                                    # apaga a configuração digitada"
  printf '  %s\n' "docker compose -f ${COMPOSE} down -v          # derruba o que subiu"
  printf '  %s\n' "bash ${KIT_DIR:-hostgator-setup-kit}/install.sh   # começa de novo"
  printf '\n%s\n' "Se o schema chegou a ser aplicado e você quer o banco limpo de novo,"
  printf '%s\n'   "abra o Supabase > SQL Editor e rode (ATENÇÃO: apaga todos os dados):"
  printf '  %s\n\n' "drop schema public cascade; create schema public;"
}
trap 'rc=$?; [ "$rc" -ne 0 ] && show_recovery; exit $rc' EXIT

# ── Validadores ─────────────────────────────────────────────────────────────
# Cada validador recebe o valor, imprime a explicação do problema em português
# e devolve != 0. Rodam ANTES de o valor entrar no .env — é o único momento em
# que a pessoa ainda pode corrigir sem desfazer nada. Um dado errado que passa
# daqui só aparece minutos depois, como erro técnico em outro lugar.

# Lê uma claim de um JWT do Supabase (chaves legadas 'eyJ...'). Só serve para
# dar mensagem de erro melhor — quem decide de verdade é a chamada HTTP real.
jwt_claim() {
  local p="${1#*.}"; p="${p%%.*}"
  p="${p//-/+}"; p="${p//_//}"
  case $(( ${#p} % 4 )) in 2) p="${p}==";; 3) p="${p}=";; esac
  printf '%s' "$p" | base64 -d 2>/dev/null \
    | grep -o "\"$2\":\"[^\"]*\"" | head -1 | cut -d'"' -f4
}
# Referência do projeto (o 'abcdef' de https://abcdef.supabase.co)
sb_ref() { local u="${1#https://}"; printf '%s' "${u%%.*}"; }

v_domain() {
  case "$1" in
    http*) echo "Digite só o domínio, sem https:// — ex.: crm.suaempresa.com.br"; return 1;;
    */*)   echo "Digite só o domínio, sem barra nem caminho — ex.: crm.suaempresa.com.br"; return 1;;
    *.*)   return 0;;
    *)     echo "Isso não parece um domínio (falta o ponto) — ex.: crm.suaempresa.com.br"; return 1;;
  esac
}

v_email() {
  case "$1" in *@*.*) return 0;; esac
  echo "E-mail inválido — precisa ter @ e um domínio, ex.: voce@suaempresa.com.br"
  return 1
}

v_supabase_url() {
  case "$1" in
    https://*.supabase.co) ;;
    *supabase.co*) echo "Cole a URL completa, começando com https:// — ex.: https://abcdefgh.supabase.co"; return 1;;
    *) echo "Essa não é a URL do projeto Supabase. Ela termina em .supabase.co e fica em Settings > API > Project URL."; return 1;;
  esac
  local code
  code="$(curl -s -o /dev/null -w '%{http_code}' -m 15 "$1/auth/v1/health" 2>/dev/null || echo 000)"
  if [ "$code" = "000" ]; then
    echo "Não consegui alcançar $1 — confira se o projeto existe, está ativo (projeto pausado não responde) e se o VPS tem internet."
    return 1
  fi
  return 0
}

# Confere formato + faz a chamada real que só a chave certa responde.
# $2 = papel esperado ('anon' ou 'service_role')
v_sb_key() {
  local key="$1" want="$2" url="${NEXT_PUBLIC_SUPABASE_URL:-}"
  case "$key" in
    eyJ*)
      local role ref
      role="$(jwt_claim "$key" role)"; ref="$(jwt_claim "$key" ref)"
      if [ -n "$role" ] && [ "$role" != "$want" ]; then
        echo "Essa é a chave '${role}', e aqui eu preciso da '${want}'. Em Settings > API elas ficam uma embaixo da outra — confira qual copiou."
        return 1
      fi
      if [ -n "$ref" ] && [ -n "$url" ] && [ "$ref" != "$(sb_ref "$url")" ]; then
        echo "Essa chave é de OUTRO projeto Supabase (${ref}), e a URL que você deu é do projeto $(sb_ref "$url"). Copie as duas do mesmo projeto."
        return 1
      fi;;
    sb_publishable_*|sb_secret_*) : ;;  # formato novo do Supabase — a prova é a chamada HTTP
    *) echo "Isso não parece uma chave do Supabase (elas começam com 'eyJ' ou 'sb_'). Pegue em Settings > API."; return 1;;
  esac
  [ -z "$url" ] && return 0
  local code
  if [ "$want" = "service_role" ]; then
    # Rota de administração: a anon leva 401 aqui. É o que separa uma da outra.
    code="$(curl -s -o /dev/null -w '%{http_code}' -m 20 \
      -H "apikey: $key" -H "Authorization: Bearer $key" \
      "$url/auth/v1/admin/users?page=1&per_page=1" 2>/dev/null || echo 000)"
  else
    # /auth/v1/settings é a rota que a anon PODE abrir. Não use /rest/v1/: ele
    # responde 401 "Only the service_role API key can be used for this endpoint"
    # até para a anon correta — validador que reprova o dado certo é pior que
    # nenhum. Provado nesta VPS: settings dá 200 para as chaves do projeto e 401
    # para lixo e para JWT de outro projeto.
    code="$(curl -s -o /dev/null -w '%{http_code}' -m 20 -H "apikey: $key" "$url/auth/v1/settings" 2>/dev/null || echo 000)"
  fi
  case "$code" in
    2*) return 0;;
    000) c_ylw "  ⚠ não consegui checar a chave online (sem resposta do Supabase); sigo com ela."; return 0;;
    401|403) echo "O Supabase recusou essa chave (resposta ${code}). Confira se copiou a '${want}' inteira, sem espaço no fim."; return 1;;
    *) echo "Resposta inesperada do Supabase ao testar a chave (${code}). Confira a chave e o projeto."; return 1;;
  esac
}
v_anon()    { v_sb_key "$1" anon; }
v_service() { v_sb_key "$1" service_role; }

v_db_url() {
  case "$1" in
    postgres://*|postgresql://*) ;;
    *) echo "A connection string começa com postgresql:// — copie em Settings > Database > Connection string, modo URI."; return 1;;
  esac
  case "$1" in
    *"[YOUR-PASSWORD]"*|*"[SUA-SENHA]"*|*"[your-password]"*)
      echo "Você colou a string com o [YOUR-PASSWORD] no meio — troque isso pela senha do banco (a que você definiu ao criar o projeto)."; return 1;;
  esac
  case "$1" in
    *db.*.supabase.co*)
      echo "Essa é a 'Direct connection' do Supabase — ela só existe em IPv6 e o VPS é IPv4, então nunca conecta."
      echo "   👉 Volte em Settings > Database e copie a do Session pooler (o host termina em .pooler.supabase.com)."
      return 1;;
  esac
  # Mesma família de projeto? (usuário do pooler é 'postgres.<ref>')
  local dbref="${1#*://}"; dbref="${dbref%%:*}"; dbref="${dbref#postgres.}"
  if [ -n "${NEXT_PUBLIC_SUPABASE_URL:-}" ] && [ "$dbref" != "postgres" ] \
     && [ "$dbref" != "$(sb_ref "$NEXT_PUBLIC_SUPABASE_URL")" ]; then
    echo "Essa connection string é do projeto '${dbref}', mas a URL que você deu é do projeto '$(sb_ref "$NEXT_PUBLIC_SUPABASE_URL")'. Precisam ser o mesmo projeto."
    return 1
  fi
  local out
  if out="$(docker run --rm postgres:17-alpine psql "$1" -tAc 'select 1' 2>&1)"; then
    return 0
  fi
  echo "Não consegui conectar no banco. O Postgres respondeu:"
  printf '   %s\n' "$(printf '%s' "$out" | head -2)"
  case "$out" in
    *"could not translate host name"*)
      echo "   👉 Quase sempre é a senha com caractere especial: na URL ela precisa ser codificada."
      echo "      Troque  @ por %40   :  por %3A   /  por %2F   ?  por %3F   #  por %23";;
    *"password authentication failed"*)
      echo "   👉 Senha do banco errada. É a senha do PROJETO (definida ao criá-lo), não a da sua conta Supabase."
      echo "      Dá pra redefinir em Settings > Database > Reset database password.";;
    *"Network is unreachable"*|*"Cannot assign requested address"*)
      echo "   👉 Isso é o problema de IPv6: use a connection string do Session pooler, não a Direct connection.";;
  esac
  return 1
}

v_anthropic() {
  case "$1" in sk-ant-*) ;; *) echo "A chave da Anthropic começa com 'sk-ant-'. Pegue em console.anthropic.com > API Keys."; return 1;; esac
  local code
  code="$(curl -s -o /dev/null -w '%{http_code}' -m 20 https://api.anthropic.com/v1/models \
    -H "x-api-key: $1" -H "anthropic-version: 2023-06-01" 2>/dev/null || echo 000)"
  case "$code" in
    2*) return 0;;
    000) c_ylw "  ⚠ não consegui checar a chave online; sigo com ela."; return 0;;
    401) echo "A Anthropic recusou essa chave (401). Confira se está ativa e se copiou inteira."; return 1;;
    *)   c_ylw "  ⚠ a Anthropic respondeu ${code} ao testar a chave; sigo com ela."; return 0;;
  esac
}

v_openai() {
  [ -z "$1" ] && return 0   # opcional
  case "$1" in sk-*) ;; *) echo "A chave da OpenAI começa com 'sk-'. Pegue em platform.openai.com > API keys (ou deixe em branco)."; return 1;; esac
  local code
  code="$(curl -s -o /dev/null -w '%{http_code}' -m 20 https://api.openai.com/v1/models \
    -H "Authorization: Bearer $1" 2>/dev/null || echo 000)"
  case "$code" in
    2*) return 0;;
    000) c_ylw "  ⚠ não consegui checar a chave online; sigo com ela."; return 0;;
    401) echo "A OpenAI recusou essa chave (401). Confira se está ativa e se copiou inteira."; return 1;;
    *)   c_ylw "  ⚠ a OpenAI respondeu ${code} ao testar a chave; sigo com ela."; return 0;;
  esac
}

v_password() {
  [ "${#1}" -ge 8 ] && return 0
  echo "Senha muito curta (${#1} caracteres). Use pelo menos 8 — é a senha de admin do seu CRM."
  return 1
}

# ── Pergunta uma coisa, valida, e aceita 'voltar' ───────────────────────────
# Devolve 0 quando o valor foi aceito, 2 quando a pessoa pediu para voltar.
# Repete a pergunta enquanto o validador reprovar: o instalador não deixa mais
# ninguém avançar carregando um dado errado.
ask_one() {
  local var="$1" prompt="$2" default="${3:-}" validator="${4:-}" secret="${5:-}" optional="${6:-}"
  local cur="${!var:-}"
  [ -n "$cur" ] && return 0
  if [ "$NONINTERACTIVE" = 1 ]; then
    if [ -n "$default" ]; then printf -v "$var" '%s' "$default"; return 0; fi
    [ -n "$optional" ] && return 0
    die "Falta $var (modo --yes exige .env preenchido)."
  fi
  local input
  while :; do
    if [ "$secret" = "secret" ]; then
      if ! read -r -s -p "$prompt${default:+ [$default]}: " input; then
        die "A entrada terminou antes de eu receber $var. Rode o instalador num terminal interativo."
      fi
      echo
    else
      if ! read -r -p "$prompt${default:+ [$default]}: " input; then
        die "A entrada terminou antes de eu receber $var. Rode o instalador num terminal interativo."
      fi
    fi
    [ "$input" = "voltar" ] && return 2
    input="${input:-$default}"
    if [ -z "$input" ]; then
      [ -n "$optional" ] && { printf -v "$var" '%s' ""; return 0; }
      c_red "  Esse campo é obrigatório. (digite 'voltar' para refazer a pergunta anterior)"
      continue
    fi
    # Campo secreto não ecoa o que foi colado — a pessoa não vê se colou, então
    # tende a colar de novo "pra garantir", e cola duas vezes na mesma linha
    # (sem separador, vira um valor só, dobrado). Isso gera chaves/connection
    # strings inválidas com erro críptico lá na frente.
    if [ "$secret" = "secret" ]; then
      local len=${#input} half=$(( ${#input} / 2 ))
      if [ $((len % 2)) -eq 0 ] && [ "${input:0:half}" = "${input:half}" ]; then
        c_red "  Esse valor parece ter sido colado 2x seguidas (o campo é secreto e não mostra o que você cola). Cole uma vez só."
        continue
      fi
    fi
    if [ -n "$validator" ]; then
      printf '  … conferindo\r'
      local msg
      if ! msg="$("$validator" "$input" 2>&1)"; then
        printf '            \r'
        printf '\033[31m  ✖ %s\033[0m\n' "$(printf '%s' "$msg" | head -1)"
        printf '%s\n' "$(printf '%s' "$msg" | tail -n +2)" | grep -v '^$' || true
        c_dim "  (digite 'voltar' para refazer a pergunta anterior)"
        continue
      fi
      [ -n "$msg" ] && printf '%s\n' "$msg"
      printf '            \r'
    fi
    if [ "$secret" = "secret" ]; then c_grn "  ✓ recebido (${#input} caracteres)"; else c_grn "  ✓"; fi
    printf -v "$var" '%s' "$input"
    return 0
  done
}

# Esconde o miolo de um segredo para a tela de conferência.
mask() {
  local v="$1"
  if [ -z "$v" ]; then printf '(vazio)'; return; fi
  if [ "${#v}" -le 12 ]; then printf '%s' "****"; else printf '%s…%s (%d caracteres)' "${v:0:8}" "${v: -4}" "${#v}"; fi
}

# Carrega só as funções acima, sem instalar nada — é assim que
# `test-validators.sh` exercita os validadores:  INSTALL_SH_LIB=1 . install.sh
if [ "${INSTALL_SH_LIB:-}" = "1" ]; then trap - EXIT; return 0; fi

# ── 1. Preflight ────────────────────────────────────────────────────────────
step "Verificando dependências"
for bin in docker git openssl curl; do
  command -v "$bin" >/dev/null 2>&1 || die "'$bin' não encontrado. Instale antes de continuar."
done
docker compose version >/dev/null 2>&1 || die "'docker compose' (v2) não encontrado."
docker info >/dev/null 2>&1 || die "O daemon do Docker não está rodando (ou seu usuário não tem permissão)."
c_grn "✓ docker, git, openssl, curl ok"

# RAM: a imagem é pré-buildada, então a stack SOBE com 2GB. Mas o runbook de produção
# declara 4GB como mínimo de operação: 7 contêineres, e o WAHA usa ~150MB por sessão
# sobre ~300MB de overhead do Node. Avisar só abaixo de 1.5GB deixava o operador
# instalar em 2GB achando que estava dentro do recomendado.
if [ -r /proc/meminfo ]; then
  mem_kb=$(awk '/MemTotal/{print $2}' /proc/meminfo)
  if [ "$mem_kb" -lt 4000000 ]; then
    c_ylw "⚠ RAM total ~$((mem_kb/1024))MB. Recomendado 4GB para operar (2GB sobe, mas no limite)."
    c_ylw "  Com menos de 4GB, adicione swap — ver docs/runbooks/waha-hostgator.md."
  fi
fi

# ── 2. Repositório ──────────────────────────────────────────────────────────
step "Localizando o projeto"
if [ -f "$COMPOSE" ]; then
  c_grn "✓ rodando dentro do repositório"
elif [ -f "$REPO_DIR/$COMPOSE" ]; then
  cd "$REPO_DIR"; c_grn "✓ repositório em ./$REPO_DIR"
else
  c_ylw "Clonando $REPO_URL ..."
  git clone --depth 1 "$REPO_URL" "$REPO_DIR"
  cd "$REPO_DIR"
fi
PROJECT_DIR="$(pwd)"
source "$KIT_DIR/_common.sh"

# ── 3. Coleta de config ─────────────────────────────────────────────────────
step "Configuração"
# Se já existe .env, carrega pra não repetir perguntas (idempotência).
if [ -f .env ]; then load_env .env; c_grn "✓ .env existente carregado"; fi

# Cada linha: VARIÁVEL|pergunta|padrão|validador|secret|opcional
# A ordem importa: a URL do projeto vem antes das chaves porque os validadores
# das chaves batem contra ela (chave de outro projeto é erro comum e mudo).
# Marca da instalação (APP_NAME) fica por último de propósito: é opcional, e
# perguntar no meio das credenciais faria parecer obrigatória.
FIELDS=(
  "DOMAIN|Domínio do CRM (ex: crm.suaempresa.com.br)||v_domain||"
  "ACME_EMAIL|Seu e-mail (avisos de SSL)||v_email||"
  "APP_IMAGE|Imagem Docker do app|ghcr.io/melgarafael/deskcommcrm:latest|||"
  "NEXT_PUBLIC_SUPABASE_URL|Supabase Project URL (Settings > API)||v_supabase_url||"
  "NEXT_PUBLIC_SUPABASE_ANON_KEY|Supabase anon key (Settings > API)||v_anon||"
  "SUPABASE_SERVICE_ROLE_KEY|Supabase service_role key (Settings > API)||v_service|secret|"
  "SUPABASE_DB_URL|Supabase connection string — Session pooler, modo URI (Settings > Database)||v_db_url|secret|"
  "ANTHROPIC_API_KEY|Chave da Anthropic — a IA que atende (console.anthropic.com)||v_anthropic|secret|"
  "OPENAI_API_KEY|Chave da OpenAI — ouvir áudios do WhatsApp e usar a base de conhecimento (Enter pula)||v_openai|secret|opcional"
  "OWNER_EMAIL|E-mail do primeiro admin (dono)||v_email||"
  "OWNER_PASSWORD|Senha do primeiro admin (mínimo 8 caracteres)||v_password|secret|"
  "APP_NAME|Nome que aparece na interface (Enter para o padrão)|DeskcommCRM|||"
)

field_at() { IFS='|' read -r F_VAR F_PROMPT F_DEF F_VAL F_SEC F_OPT <<< "${FIELDS[$1]}"; }

if [ "$NONINTERACTIVE" = 0 ]; then
  c_dim "Dica: em qualquer pergunta, digite 'voltar' para refazer a anterior."
  c_ylw "A chave da OpenAI é opcional, mas sem ela a IA não ouve áudio nem consulta a base de conhecimento."
fi

i=0
while [ "$i" -lt "${#FIELDS[@]}" ]; do
  field_at "$i"
  set +e; ask_one "$F_VAR" "$F_PROMPT" "$F_DEF" "$F_VAL" "$F_SEC" "$F_OPT"; rc=$?; set -e
  if [ "$rc" = "2" ]; then
    if [ "$i" -eq 0 ]; then c_ylw "  Essa já é a primeira pergunta."; continue; fi
    i=$((i-1)); field_at "$i"; unset "$F_VAR"      # limpa o anterior para ele ser perguntado de novo
  else
    i=$((i+1))
  fi
done

# ── Conferência: a última chance de corrigir sem desfazer nada ──────────────
# Numa 2ª execução todos os campos já vêm do .env — então esta tela é também
# o caminho para consertar um valor digitado errado antes, que antes ficava
# preso no .env sem nenhuma forma de trocar pelo instalador.
if [ "$NONINTERACTIVE" = 0 ]; then
  while :; do
    printf '\n\033[1mConfira antes de eu escrever a configuração:\033[0m\n\n'
    n=1
    for f in "${FIELDS[@]}"; do
      IFS='|' read -r v p _d _val sec _o <<< "$f"
      if [ "$sec" = "secret" ]; then printf '  [%2d] %-28s %s\n' "$n" "${v}" "$(mask "${!v:-}")"
      else printf '  [%2d] %-28s %s\n' "$n" "${v}" "${!v:-(vazio)}"; fi
      n=$((n+1))
    done
    printf '\n'
    if ! read -r -p "Está tudo certo? (Enter = continuar / número = corrigir): " answer; then answer=""; fi
    [ -z "$answer" ] && break
    case "$answer" in
      ''|*[!0-9]*) c_ylw "Digite o número do item que quer corrigir, ou Enter para continuar."; continue;;
    esac
    if [ "$answer" -lt 1 ] || [ "$answer" -gt "${#FIELDS[@]}" ]; then
      c_ylw "Número fora da lista."; continue
    fi
    field_at "$((answer-1))"; unset "$F_VAR"
    set +e; ask_one "$F_VAR" "$F_PROMPT" "$F_DEF" "$F_VAL" "$F_SEC" "$F_OPT"; set -e
  done
else
  # Sem tela para conferir: os validadores continuam sendo a rede de proteção.
  for f in "${FIELDS[@]}"; do
    IFS='|' read -r v _p _d val _sec opt <<< "$f"
    [ -z "$val" ] && continue
    [ -z "${!v:-}" ] && { [ -n "$opt" ] && continue; die "Falta $v (modo --yes exige .env preenchido)."; }
    if ! msg="$("$val" "${!v}" 2>&1)"; then
      c_red "✖ $v inválido:"; printf '%s\n' "$msg"
      die "Corrija o .env e rode de novo."
    fi
  done
fi

# Derivados
NEXT_PUBLIC_APP_URL="https://${DOMAIN}"
NEXT_PUBLIC_ADMIN_URL="https://${DOMAIN}"

# ── 4. Geração de segredos (idempotente: só gera o que falta) ────────────────
step "Gerando segredos"
gen_hex() { openssl rand -hex 32; }
gen_b64() { openssl rand -base64 32; }
: "${INTERNAL_SECRET:=$(gen_hex)}"
: "${INTERNAL_CRON_SECRET:=$(gen_hex)}"
: "${NUVEMSHOP_OAUTH_ENCRYPTION_KEY:=$(gen_hex)}"
: "${CPF_ENCRYPTION_KEY:=$(gen_b64)}"
: "${AI_CRED_AES_KEY:=$(gen_b64)}"
: "${WAHA_BYO_ENCRYPTION_KEY:=$(gen_b64)}"
: "${IMPERSONATE_COOKIE_SECRET:=$(gen_hex)}"
: "${LGPD_SIGNING_KEY:=$(gen_hex)}"
: "${WAHA_HMAC_SECRET:=$(gen_hex)}"
: "${SRH_TOKEN:=$(gen_hex)}"
: "${WAHA_API_KEY:=$(gen_hex)}"
# O container WAHA espera o HASH SHA512 hex; o app envia o plaintext no X-Api-Key.
WAHA_API_KEY_SHA512="$(printf '%s' "$WAHA_API_KEY" | openssl dgst -sha512 -hex | awk '{print $NF}')"
UPSTASH_REDIS_REST_TOKEN="$SRH_TOKEN"
c_grn "✓ segredos prontos"

# ── 5. Escreve .env (600) ───────────────────────────────────────────────────
step "Escrevendo .env"
umask 077

# Todo valor sai entre aspas simples, com aspa interna escapada. Sem isso, um
# `APP_NAME=Loja do João` (ou uma senha com # ou $) quebrava tudo que lê este
# arquivo com `source` — os scripts do kit e a receita do próprio README
# (`source .env && curl ...`). O Docker Compose remove as aspas ao carregar,
# então o contêiner recebe exatamente o valor digitado.
envq() { printf "%s='%s'\n" "$1" "$(printf '%s' "${2-}" | sed "s/'/'\\\\''/g")"; }

{
  printf '# Gerado por install.sh — NÃO comitar. Contém segredos.\n'
  envq APP_IMAGE "$APP_IMAGE"
  envq APP_PULL_POLICY "always"
  envq DOMAIN "$DOMAIN"
  envq ACME_EMAIL "$ACME_EMAIL"
  envq NEXT_PUBLIC_SUPABASE_URL "$NEXT_PUBLIC_SUPABASE_URL"
  envq NEXT_PUBLIC_SUPABASE_ANON_KEY "$NEXT_PUBLIC_SUPABASE_ANON_KEY"
  envq SUPABASE_SERVICE_ROLE_KEY "$SUPABASE_SERVICE_ROLE_KEY"
  envq SUPABASE_DB_URL "$SUPABASE_DB_URL"
  envq NEXT_PUBLIC_APP_URL "$NEXT_PUBLIC_APP_URL"
  envq NEXT_PUBLIC_ADMIN_URL "$NEXT_PUBLIC_ADMIN_URL"
  printf '# Marca da instalação (white-label). Preencha APP_LOGO_URL com a URL de uma\n'
  printf '# imagem pública para trocar o texto por logo na sidebar. Ver lib/branding.ts.\n'
  envq APP_NAME "$APP_NAME"
  envq APP_LOGO_URL "${APP_LOGO_URL:-}"
  envq ANTHROPIC_API_KEY "$ANTHROPIC_API_KEY"
  envq AI_GATEWAY_API_KEY "${AI_GATEWAY_API_KEY:-}"
  printf '# OpenAI: transcrição dos áudios do WhatsApp (Whisper) + embeddings do RAG.\n'
  printf '# Opcional — sem ela a IA responde sem a base e pede o áudio em texto.\n'
  envq OPENAI_API_KEY "${OPENAI_API_KEY:-}"
  printf '# Telemetria de erros. Vazio = manda pro Sentry da comunidade (ajuda a\n'
  printf '# corrigir bugs que afetam todo mundo). "off" = não envia nada. Ou ponha o\n'
  printf '# DSN do SEU Sentry para receber os erros desta instalação.\n'
  envq SENTRY_DSN "${SENTRY_DSN:-}"
  envq INTERNAL_SECRET "$INTERNAL_SECRET"
  envq INTERNAL_CRON_SECRET "$INTERNAL_CRON_SECRET"
  envq NUVEMSHOP_OAUTH_ENCRYPTION_KEY "$NUVEMSHOP_OAUTH_ENCRYPTION_KEY"
  envq CPF_ENCRYPTION_KEY "$CPF_ENCRYPTION_KEY"
  envq AI_CRED_AES_KEY "$AI_CRED_AES_KEY"
  envq WAHA_BYO_ENCRYPTION_KEY "$WAHA_BYO_ENCRYPTION_KEY"
  envq IMPERSONATE_COOKIE_SECRET "$IMPERSONATE_COOKIE_SECRET"
  envq LGPD_SIGNING_KEY "$LGPD_SIGNING_KEY"
  envq WAHA_API_BASE_URL "http://waha:3000"
  envq WAHA_WEBHOOK_BASE_URL "http://app:3000"
  envq WAHA_API_KEY "$WAHA_API_KEY"
  envq WAHA_API_KEY_SHA512 "$WAHA_API_KEY_SHA512"
  envq WAHA_HMAC_SECRET "$WAHA_HMAC_SECRET"
  printf '# "true" exige assinatura em todo webhook do WAHA. O WAHA Core NÃO assina,\n'
  printf '# então ligar isto sem um WAHA Plus (ou proxy que assine) para a ingestão\n'
  printf '# de mensagens. A rota global já não é publicada na internet (ver Caddyfile).\n'
  envq WAHA_WEBHOOK_REQUIRE_SIGNATURE "${WAHA_WEBHOOK_REQUIRE_SIGNATURE:-false}"
  envq WAHA_IMAGE "${WAHA_IMAGE:-devlikeapro/waha}"
  envq WAHA_DEFAULT_ENGINE "${WAHA_DEFAULT_ENGINE:-NOWEB}"
  envq UPSTASH_REDIS_REST_URL "http://srh:80"
  envq UPSTASH_REDIS_REST_TOKEN "$UPSTASH_REDIS_REST_TOKEN"
  envq SRH_TOKEN "$SRH_TOKEN"
  envq NODE_ENV "production"
  envq NUVEMSHOP_ENABLED "false"
  envq INTERNAL_AGENT_RUN_STUB "false"
  envq OWNER_EMAIL "$OWNER_EMAIL"
  envq OWNER_PASSWORD "$OWNER_PASSWORD"
} > .env
chmod 600 .env
c_grn "✓ .env escrito (permissão 600)"

# ── 6. Checagem de DNS ──────────────────────────────────────────────────────
step "Conferindo DNS de ${DOMAIN}"
public_ip="$(curl -fsS --max-time 8 https://api.ipify.org 2>/dev/null || echo '')"
# Um domínio pode ter A (IPv4) e AAAA (IPv6) ao mesmo tempo, e o resolver não
# garante ordem entre eles. Comparar só o PRIMEIRO endereço (o antigo `hosts`
# + `head -1`) dava falso alarme sempre que o AAAA vinha antes do A: o DNS
# estava correto, o SSL ia ser emitido normalmente, e mesmo assim o instalador
# dizia que o domínio não apontava pra cá — assustando quem instala bem na hora
# em que ela mais precisa de confiança. `ahosts` lista TODOS os endereços; basta
# que UM deles seja o IP do VPS.
resolved="$(getent ahosts "$DOMAIN" 2>/dev/null | awk '{print $1}' | sort -u | tr '\n' ' ' || echo '')"
if [ -n "$public_ip" ] && case " $resolved " in *" $public_ip "*) true;; *) false;; esac; then
  c_grn "✓ ${DOMAIN} → ${public_ip} (aponta pra este VPS)"
else
  c_ylw "⚠ ${DOMAIN} resolve para '${resolved:-nada}' e o IP deste VPS é '${public_ip:-desconhecido}'."
  c_ylw "  O SSL (Let's Encrypt) só será emitido quando o A-record apontar pra cá."
  [ "$NONINTERACTIVE" = 0 ] && { read -r -p "  Continuar mesmo assim? (s/N) " a; [ "${a:-N}" = "s" ] || die "Ajuste o DNS e rode de novo."; }
fi

# ── 7. Aplica o schema (baseline) no Supabase — via container postgres ───────
step "Aplicando o schema no Supabase (baseline.sql)"
if [ -f supabase/baseline.sql ]; then
  # O baseline é um pg_dump: referencia public.vector, public.citext e gin_trgm_ops
  # (pg_trgm) mas NÃO cria as extensões. Supabase não as habilita no schema public por
  # padrão — criamos aqui, senão o schema quebra no meio (ex.: "type public.vector does
  # not exist"). Idempotente (if not exists).
  docker run --rm postgres:17-alpine psql "$SUPABASE_DB_URL" -v ON_ERROR_STOP=1 -c \
    "create extension if not exists vector with schema public; create extension if not exists citext with schema public; create extension if not exists pg_trgm with schema public;" \
    >/dev/null 2>&1 \
    && c_grn "✓ extensões (vector, citext, pg_trgm) habilitadas no public" \
    || c_ylw "⚠ não consegui habilitar as extensões — o schema pode falhar abaixo."
  SCHEMA_LOG="$PROJECT_DIR/baseline-apply.log"
  # Banco novo ou re-execução? Re-aplicar com ON_ERROR_STOP pararia no primeiro
  # "já existe" (ex.: multiple primary keys) e PULARIA o resto do arquivo —
  # inclusive o apêndice com as migrations novas. Banco existente = modo update
  # (mesmo contrato do update.sh); banco novo = ON_ERROR_STOP e falha é FATAL
  # (schema pela metade = app sem RLS).
  # O `|| true` não é preguiça: sem ele, um psql que falha aqui sai com código 2
  # dentro da substituição e, com `set -e` + `pipefail`, derruba o instalador sem
  # imprimir nada (o 2>/dev/null já tinha engolido a causa). Preferimos seguir e
  # deixar o erro aparecer no ponto em que dá para explicá-lo.
  has_schema="$(docker run --rm postgres:17-alpine psql "$SUPABASE_DB_URL" -tAc \
    "select 1 from information_schema.tables where table_schema='public' and table_name='organizations' limit 1" 2>/dev/null | tr -d '[:space:]' || true)"

  if [ "$has_schema" = "1" ]; then
    c_ylw "• schema já existe — re-aplicando em modo update (erros 'já existe' são esperados e ficam no log)"
    raw="$(docker run --rm -i -v "$PROJECT_DIR/supabase/baseline.sql:/baseline.sql:ro" \
          postgres:17-alpine psql "$SUPABASE_DB_URL" -q -f /baseline.sql 2>&1 || true)"
    printf '%s\n' "$raw" > "$SCHEMA_LOG"
    benign='already exists|multiple primary keys|multiple default values|is already a member|already a partition'
    unexpected="$(printf '%s\n' "$raw" | grep -iE 'ERROR|FATAL' | grep -viE "$benign" || true)"
    if [ -n "$unexpected" ]; then
      c_ylw "⚠ Erros no banco que NÃO são os esperados (log completo: $SCHEMA_LOG):"
      printf '%s\n' "$unexpected" | head -20
    else
      c_grn "✓ schema re-aplicado (apêndice de migrations incluído)"
    fi
  else
    if docker run --rm -i -v "$PROJECT_DIR/supabase/baseline.sql:/baseline.sql:ro" \
        postgres:17-alpine psql "$SUPABASE_DB_URL" -v ON_ERROR_STOP=1 -f /baseline.sql \
        > "$SCHEMA_LOG" 2>&1; then
      c_grn "✓ schema aplicado (log: $SCHEMA_LOG)"
    else
      tail -5 "$SCHEMA_LOG"
      die "baseline falhou num banco NOVO — o schema ficaria incompleto (sem RLS). Log completo: $SCHEMA_LOG"
    fi
  fi

  # Verificação real, não wishful thinking: o app precisa das tabelas core.
  n_tables="$(docker run --rm postgres:17-alpine psql "$SUPABASE_DB_URL" -tAc \
    "select count(*) from information_schema.tables where table_schema='public'" 2>/dev/null | tr -d '[:space:]')"
  if [ "${n_tables:-0}" -ge 30 ]; then
    c_grn "✓ verificação: ${n_tables} tabelas no schema public"
  else
    c_ylw "⚠ verificação: só ${n_tables:-0} tabelas no schema public — confira $SCHEMA_LOG"
  fi
else
  c_ylw "⚠ supabase/baseline.sql não encontrado — pulei (aplique o schema manualmente)."
fi

# ── 8. Bootstrap do 1º dono (cria no Auth + promove via psql) ───────────────
step "Criando o primeiro admin (${OWNER_EMAIL})"
# 1) Cria o usuário no Supabase Auth. Se já existe, a API responde 422 — ignoramos
#    (|| true): a re-execução é idempotente, o passo seguinte encontra o usuário.
curl -fsS -X POST "${NEXT_PUBLIC_SUPABASE_URL}/auth/v1/admin/users" \
  -H "apikey: ${SUPABASE_SERVICE_ROLE_KEY}" \
  -H "Authorization: Bearer ${SUPABASE_SERVICE_ROLE_KEY}" \
  -H "Content-Type: application/json" \
  -d "{\"email\":\"${OWNER_EMAIL}\",\"password\":\"${OWNER_PASSWORD}\",\"email_confirm\":true}" \
  >/dev/null 2>&1 || true

# 2) Resolve o id direto do auth.users e cria org + membership + platform_admin.
#    Resolver o uid DENTRO do SQL evita parsing frágil de JSON e funciona tanto para
#    usuário recém-criado quanto para um que já existia (re-execução).
docker run --rm -i postgres:17-alpine psql "$SUPABASE_DB_URL" -v ON_ERROR_STOP=1 <<SQL \
  && c_grn "✓ dono criado e promovido a super-admin" \
  || die "Não consegui promover o admin. Confira a service_role key, a URL e a connection string do Supabase."
do \$\$
declare v_org uuid; v_uid uuid;
begin
  select id into v_uid from auth.users where email = '${OWNER_EMAIL}';
  if v_uid is null then
    raise exception 'usuário % não encontrado no auth.users (a criação no Auth falhou?)', '${OWNER_EMAIL}';
  end if;
  select id into v_org from public.organizations where slug='minha-empresa';
  if v_org is null then
    insert into public.organizations (slug, display_name, legal_name, created_by)
    values ('minha-empresa','Minha Empresa','Minha Empresa', v_uid) returning id into v_org;
  end if;
  insert into public.user_organizations (user_id, organization_id, role, accepted_at)
  values (v_uid, v_org, 'admin', now())
  on conflict (user_id, organization_id) do update set role='admin', revoked_at=null;
  if not exists (select 1 from public.platform_admins where user_id=v_uid and revoked_at is null) then
    insert into public.platform_admins (user_id, granted_by, scope, reason)
    values (v_uid, v_uid, 'full', 'Bootstrap inicial do self-host');
  end if;
end \$\$;
SQL

# ── 9. Sobe a stack ─────────────────────────────────────────────────────────
step "Puxando a imagem e subindo os serviços"
docker compose -f "$COMPOSE" pull
docker compose -f "$COMPOSE" up -d
c_grn "✓ containers no ar"

# ── 10. Healthcheck ─────────────────────────────────────────────────────────
step "Aguardando o app ficar saudável"
ok=0
for i in $(seq 1 30); do
  if docker compose -f "$COMPOSE" exec -T app node -e "require('net').connect(3000,'127.0.0.1').on('connect',()=>process.exit(0)).on('error',()=>process.exit(1))" 2>/dev/null; then
    ok=1; break
  fi
  sleep 3
done
[ "$ok" = 1 ] && c_grn "✓ app respondendo" || c_ylw "⚠ app ainda não respondeu. Veja: docker compose -f $COMPOSE logs app"

# ── 11. Automações (cron do drain de eventos) ───────────────────────────────
step "Ativando as automações"
ensure_encryption_key .env
setup_event_log_drain_cron
setup_update_agent_cron

# ── Final ───────────────────────────────────────────────────────────────────
cat <<DONE

$(c_grn "═══════════════════════════════════════════════════════")
$(c_grn " Instalação concluída!")
$(c_grn "═══════════════════════════════════════════════════════")

  1. Acesse:  https://${DOMAIN}
     (o SSL leva ~1min pra emitir no primeiro acesso)

  2. Faça login com:
       e-mail: ${OWNER_EMAIL}
       senha:  (a que você definiu)

  3. Conecte o WhatsApp (2º passo do onboarding):
       Deixe o WhatsApp JÁ ABERTO em Configurações → Aparelhos conectados
       antes de abrir a tela — o QR code vale só uns minutos. Se expirar,
       o próprio CRM tem o botão "Gerar novo QR Code".

  4. Ao terminar o onboarding, o CRM pede a verificação em duas etapas:
       tenha o Google Authenticator/Authy à mão e GUARDE os códigos de
       recuperação que aparecem. Perdeu o celular? bash hostgator-setup-kit/reset-mfa.sh ${OWNER_EMAIL}

  Telemetria: por padrão os erros desta instalação são enviados ao Sentry do
  projeto, o que ajuda a corrigir falhas que afetam todo mundo. Para desligar,
  ponha SENTRY_DSN='off' no .env e rode: docker compose -f ${COMPOSE} up -d

  Comandos úteis:
    ver logs:      docker compose -f ${COMPOSE} logs -f app
    reiniciar:     docker compose -f ${COMPOSE} restart
    atualizar:     bash hostgator-setup-kit/update.sh
    backup:        bash hostgator-setup-kit/backup.sh
    trocar config: bash hostgator-setup-kit/install.sh
                   (mostra tudo o que você respondeu e deixa corrigir por número)
    recomeçar:     docker compose -f ${COMPOSE} down -v && rm -f .env
                   (derruba tudo; depois rode o install.sh de novo)

DONE
