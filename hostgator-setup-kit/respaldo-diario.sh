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

# Rotação: os diários além de 14 saem. `-name 'diario-*'` para NUNCA tocar nos
# respaldos manuais pre-esquema, que têm outro prefixo e outra razão de existir.
find "$DEST" -name 'diario-*.sql.gz' -mtime +14 -delete
