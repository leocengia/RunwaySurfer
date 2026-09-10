#!/usr/bin/env bash
#
# Fabbrica le varianti di pacchetto che servono agli scenari del collaudo,
# partendo da un pacchetto BUONO prodotto dalla CI. Non serve una nuova build:
# si scompatta, si guasta il punto giusto, si ricomprime.
#
# A mano è un lavoro noioso e facile da sbagliare in modi che falsano lo
# scenario — soprattutto l'id, vedi sotto.
#
# Uso:
#   fabbrica-pacchetto.sh <buono.tar.gz> [opzioni]
#
#   --nuovo-id             id e shortCommit nuovi: serve a ogni pacchetto che
#                          deve installarsi come release DISTINTA (S1)
#   --senza-dist           toglie dist/index.js → il servizio va in crash-loop (S3)
#   --senza-build-sqlite   toglie node_modules/better-sqlite3/build (S3b)
#   --schema N             forza schemaVersion a N nel RELEASE.json (S4)
#   -o, --output DIR       dove scrivere (default: la cartella del pacchetto)
#
# Esempi:
#   fabbrica-pacchetto.sh buono.tar.gz --nuovo-id
#   fabbrica-pacchetto.sh buono.tar.gz --nuovo-id --senza-dist        # S3
#   fabbrica-pacchetto.sh buono.tar.gz --nuovo-id --schema 4          # S4
#
set -euo pipefail

# Sovrascrivibile solo per poter provare questo script fuori dal bersaglio (es.
# Git Bash su Windows). Sul rack e in WSL resta /usr/bin/node, lo stesso che la
# unit cabla in ExecStart.
NODE_BIN="${NODE_BIN:-/usr/bin/node}"

die() {
  printf '\033[31mERRORE:\033[0m %s\n' "$*" >&2
  exit 1
}
info() { printf '  %s\n' "$*" >&2; }

SORGENTE=""
OUTDIR=""
NUOVO_ID=0
SENZA_DIST=0
SENZA_BUILD=0
SCHEMA=""

while [[ $# -gt 0 ]]; do
  case "$1" in
    --nuovo-id) NUOVO_ID=1 ;;
    --senza-dist) SENZA_DIST=1 ;;
    --senza-build-sqlite) SENZA_BUILD=1 ;;
    --schema)
      [[ $# -ge 2 ]] || die '--schema richiede un numero'
      SCHEMA="$2"
      shift
      ;;
    -o | --output)
      [[ $# -ge 2 ]] || die '--output richiede una cartella'
      OUTDIR="$2"
      shift
      ;;
    -h | --help)
      sed -n '2,28p' "$0" | sed 's/^# \{0,1\}//'
      exit 0
      ;;
    -*) die "opzione non riconosciuta: $1" ;;
    *) SORGENTE="$1" ;;
  esac
  shift
done

[[ -n "$SORGENTE" ]] || die 'manca il pacchetto di partenza. Uso: fabbrica-pacchetto.sh <buono.tar.gz> [opzioni]'
[[ -f "$SORGENTE" ]] || die "pacchetto non trovato: $SORGENTE"
[[ -x "$NODE_BIN" ]] || die "$NODE_BIN non trovato (serve per riscrivere RELEASE.json)"
if [[ -n "$SCHEMA" && ! "$SCHEMA" =~ ^[0-9]+$ ]]; then
  die "--schema vuole un numero, non '$SCHEMA'"
fi

[[ -n "$OUTDIR" ]] || OUTDIR="$(cd "$(dirname "$SORGENTE")" && pwd)"
mkdir -p "$OUTDIR"

LAVORO="$(mktemp -d)"
trap 'rm -rf "$LAVORO"' EXIT

info "scompatto $SORGENTE"
mkdir -p "$LAVORO/pkg"
# --no-same-owner: l'archivio porta l'uid di chi l'ha creato in CI.
tar -xzf "$SORGENTE" -C "$LAVORO/pkg" --no-same-owner

STAMP="$LAVORO/pkg/RELEASE.json"
[[ -f "$STAMP" ]] || die "il pacchetto non contiene RELEASE.json: è davvero un bundle della CI?"

# ------------------------------------------------------------ mutazioni ----

ETICHETTE=()

if [[ $SENZA_DIST -eq 1 ]]; then
  [[ -f "$LAVORO/pkg/dist/index.js" ]] || die 'dist/index.js non è nel pacchetto: niente da rimuovere'
  rm -f "$LAVORO/pkg/dist/index.js"
  ETICHETTE+=(senza-dist)
  info 'rimosso dist/index.js  → il servizio andrà in crash-loop (S3)'
fi

if [[ $SENZA_BUILD -eq 1 ]]; then
  [[ -d "$LAVORO/pkg/node_modules/better-sqlite3/build" ]] ||
    die 'node_modules/better-sqlite3/build non è nel pacchetto: niente da rimuovere'
  rm -rf "$LAVORO/pkg/node_modules/better-sqlite3/build"
  ETICHETTE+=(senza-build-sqlite)
  info 'rimosso node_modules/better-sqlite3/build  → deve essere rifiutato prima di toccare qualunque cosa (S3b)'
fi

NUOVO_ID_VAL=""
NUOVO_SHA=""
if [[ $NUOVO_ID -eq 1 ]]; then
  # L'ID DEVE CONSERVARE IL PREFISSO DATA e crescere a ogni fabbricazione. La
  # potatura nello script di aggiornamento ordina con `sort -r`, cioè
  # LESSICOGRAFICAMENTE e non per data: se l'ordine degli id non corrisponde
  # all'ordine di installazione, la potatura cancella la release sbagliata e S1
  # misura una cosa falsa, senza dare alcun segnale.
  #
  # Un timestamp NON basta: due pacchetti fabbricati nello stesso minuto
  # avrebbero lo stesso campo e si ordinerebbero per sha, che è casuale. Serve un
  # contatore. Parte da 9000 perché i numeri di run della CI sono piccoli
  # (0016...): così un pacchetto fabbricato ordina sempre DOPO quello vero della
  # stessa data, che è anche l'ordine in cui li si installa.
  SEQFILE="$OUTDIR/.collaudo-seq"
  SEQ=9000
  if [[ -r "$SEQFILE" ]]; then
    SEQ="$(cat "$SEQFILE")"
    [[ "$SEQ" =~ ^[0-9]+$ ]] || SEQ=9000
    SEQ=$((SEQ + 1))
  fi
  [[ $SEQ -le 9999 ]] || die "contatore esaurito ($SEQFILE): cancellalo per ripartire da 9000"
  printf '%s\n' "$SEQ" >"$SEQFILE"

  NUOVO_SHA="$("$NODE_BIN" -p "require('crypto').randomBytes(8).toString('hex').slice(0,7)")"
  NUOVO_ID_VAL="$(date -u +%Y-%m-%d).$SEQ.$NUOVO_SHA"
  ETICHETTE+=(nuovo-id)
  info "id nuovo: $NUOVO_ID_VAL  (shortCommit $NUOVO_SHA)"
fi

if [[ -n "$SCHEMA" ]]; then
  ETICHETTE+=("schema$SCHEMA")
  info "schemaVersion forzato a $SCHEMA (S4)"
fi

[[ ${#ETICHETTE[@]} -gt 0 ]] || die 'nessuna modifica richiesta: sarebbe una copia del pacchetto di partenza'

# Riscrittura di RELEASE.json con Node: niente sed su JSON.
NUOVO_ID_VAL="$NUOVO_ID_VAL" NUOVO_SHA="$NUOVO_SHA" SCHEMA="$SCHEMA" \
  "$NODE_BIN" -e '
  const fs = require("node:fs");
  const path = process.argv[1];
  const r = JSON.parse(fs.readFileSync(path, "utf8"));
  if (process.env.NUOVO_ID_VAL) {
    r.id = process.env.NUOVO_ID_VAL;
    r.shortCommit = process.env.NUOVO_SHA;
    r.commit = process.env.NUOVO_SHA.padEnd(40, "0");
  }
  if (process.env.SCHEMA) r.schemaVersion = Number(process.env.SCHEMA);
  r.fabbricatoDa = "collaudo/fabbrica-pacchetto.sh";
  r.fabbricatoIl = new Date().toISOString();
  fs.writeFileSync(path, JSON.stringify(r, null, 2) + "\n");
' "$STAMP"

ID="$("$NODE_BIN" -p 'JSON.parse(require("node:fs").readFileSync(process.argv[1],"utf8")).id' "$STAMP")"

# ------------------------------------------------------------ pacchetto ----

SUFFISSO="$(
  IFS=+
  echo "${ETICHETTE[*]}"
)"
TARBALL="$OUTDIR/runwaysurfer-server-$ID.$SUFFISSO.tar.gz"

# tar e non zip, e -C così l'archivio ha la stessa forma di quello della CI
# (./dist, ./node_modules, ./deploy, ./RELEASE.json): il bit di eseguibile e i
# symlink di node_modules/.bin vanno preservati.
tar -czf "$TARBALL" -C "$LAVORO/pkg" .
(cd "$OUTDIR" && sha256sum "$(basename "$TARBALL")" >"$(basename "$TARBALL").sha256")

printf '\n\033[32mfatto\033[0m  %s  (%s)\n' "$TARBALL" "$(du -h "$TARBALL" | cut -f1)"
printf '       id %s · schema %s\n' \
  "$ID" \
  "$("$NODE_BIN" -p 'JSON.parse(require("node:fs").readFileSync(process.argv[1],"utf8")).schemaVersion' "$STAMP")"
printf '       sudo runwaysurfer-update %s\n' "$TARBALL"
