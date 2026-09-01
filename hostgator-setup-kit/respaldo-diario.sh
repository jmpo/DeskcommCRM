#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# RESPALDO DIARIO DA BASE — o que separa um susto de uma catástrofe.
#
# Por que ele existe: até 22/08/2026 os únicos respaldos desta instalação eram
# os feitos À MÃO antes de cada mudança de schema. Um DELETE errado numa
# terça-feira comum não tinha cobertura nenhuma.
#
# A geografia é o ponto forte do desenho: a base vive no Supabase (AWS) e o
# dump fica NA VPS (outro provedor). Perder os dois no mesmo dia exige dois
# desastres independentes.
#
# ── Decisões, e por quê ─────────────────────────────────────────────────────
# - `docker run postgres:17-alpine`: o MESMO caminho que install.sh/update.sh
#   usam para falar com a base — a VPS não precisa de psql instalado.
# - Rotação de 14 diários: ~500 MB no pior caso medido (37 MB/dump), contra
#   29 GB livres. Cabe folgado e cobre "percebi o estrago duas semanas depois".
# - O dump é testado com `gzip -t` ANTES de contar como sucesso: um arquivo
#   truncado por disco cheio parece um respaldo e não é — é a pior mentira
#   possível neste arquivo.
# - Falha grava em `respaldo-diario.log` E deixa o último erro em
#   `respaldo-ultimo-erro.txt` — um lugar fixo que qualquer vigia pode olhar.
# ─────────────────────────────────────────────────────────────────────────────
set -u
DIR="$(cd "$(dirname "$0")/.." && pwd)"
DEST="$DIR/backups"
LOG="$DEST/respaldo-diario.log"
ERRO="$DEST/respaldo-ultimo-erro.txt"
mkdir -p "$DEST"

log() { printf '%s %s\n' "$(date -u '+%Y-%m-%dT%H:%M:%SZ')" "$1" >> "$LOG"; }

DB="$(grep -oP '(?<=^SUPABASE_DB_URL=).*' "$DIR/.env" 2>/dev/null | tr -d '"'"'"'')"
if [ -z "$DB" ]; then
  echo "SUPABASE_DB_URL ausente no .env" > "$ERRO"; log "FALHA: sem SUPABASE_DB_URL"; exit 1
fi

ARQ="$DEST/diario-$(date +%Y%m%d).sql.gz"
TMP="$ARQ.parcial"

if docker run --rm postgres:17-alpine pg_dump "$DB" 2>>"$LOG" | gzip > "$TMP" \
   && gzip -t "$TMP" 2>>"$LOG" \
   && [ "$(stat -c%s "$TMP")" -gt 1048576 ]; then
  mv "$TMP" "$ARQ"
  rm -f "$ERRO"
  log "OK: $(basename "$ARQ") ($(du -h "$ARQ" | cut -f1))"
else
  rm -f "$TMP"
  echo "dump falhou ou saiu menor que 1 MB — ver $LOG" > "$ERRO"
  log "FALHA: dump inválido ou pequeno demais"
  exit 1
fi

# ── OS OUTROS SITES DA VPS ───────────────────────────────────────────────────
#
# A VPS deixou de ser só o CRM: sites migrados (WordPress em contêiner) vivem
# aqui e merecem o mesmo guarda-chuva. O bloco é CONDICIONAL — instalação sem
# esses contêineres pula em silêncio, e o respaldo do CRM nunca depende dele.
#
# Duas peças por site, porque são dois desastres diferentes:
#  - o dump da base (posts, leads, configuração) — o que muda todo dia;
#  - o tar do webroot (tema, plugins, uploads) — o que muda quando alguém mexe.
if docker ps --format '{{.Names}}' | grep -q '^sandra-db-1$'; then
  SB="$DEST/sandra-$(date +%Y%m%d).sql.gz"
  if docker exec sandra-db-1 sh -c 'mariadb-dump -uwordpress -p"$MYSQL_PASSWORD" wordpress' 2>>"$LOG" | gzip > "$SB.parcial" \
     && gzip -t "$SB.parcial" 2>>"$LOG" && [ "$(stat -c%s "$SB.parcial")" -gt 10240 ]; then
    mv "$SB.parcial" "$SB"; log "OK sandra-db: $(du -h "$SB" | cut -f1)"
  else
    rm -f "$SB.parcial"; echo "dump do sandra-db falhou — ver $LOG" > "$ERRO"; log "FALHA: sandra-db"
  fi
  SW="$DEST/sandra-files-$(date +%Y%m%d).tar.gz"
  if docker exec sandra-wordpress-1 tar -czf - -C /var/www/html wp-content 2>>"$LOG" > "$SW.parcial" \
     && [ "$(stat -c%s "$SW.parcial")" -gt 1048576 ]; then
    mv "$SW.parcial" "$SW"; log "OK sandra-files: $(du -h "$SW" | cut -f1)"
  else
    rm -f "$SW.parcial"; echo "tar do sandra-wordpress falhou — ver $LOG" > "$ERRO"; log "FALHA: sandra-files"
  fi
  find "$DEST" -name 'sandra-*.gz' -mtime +14 -delete
fi

# Rotação: os diários além de 14 saem. `-name 'diario-*'` para NUNCA tocar nos
# respaldos manuais pre-esquema, que têm outro prefixo e outra razão de existir.
find "$DEST" -name 'diario-*.sql.gz' -mtime +14 -delete
