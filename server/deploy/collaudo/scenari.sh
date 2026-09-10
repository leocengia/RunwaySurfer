#!/usr/bin/env bash
#
# Pass 2 del collaudo: gli scenari S1..S5, con i criteri di successo verificati
# invece che letti a occhio.
#
# Da eseguire DOPO Pass 1 (prima installazione dal RUNBOOK) e dopo che
# 00-preflight.sh è verde.
#
# Uso:
#   sudo deploy/collaudo/scenari.sh <buono.tar.gz> [S1|S2|S3|S3b|S4|S4b|S5|tutti]
#
# Senza nome di scenario li esegue tutti in ordine. Ogni scenario è invocabile
# da solo: serve per ripetere S3, S4b e S5, che sono quelli che giustificano il
# lavoro fatto in precedenza.
#
# NOTA SUL `set`: qui NON c'è `-e`. Metà dei comandi di questo script DEVONO
# fallire (è il loro criterio di successo), e un `-e` renderebbe il driver più
# fragile di ciò che sta provando. Gli esiti si controllano esplicitamente.
#
set -uo pipefail

ROOT=/opt/runwaysurfer
RELEASES="$ROOT/releases"
LINK="$ROOT/server"
BACKUPS="$ROOT/backups"
DB=/var/lib/runwaysurfer/runwaysurfer.db
UNIT=runwaysurfer
UPDATE=runwaysurfer-update
PORT=8787
QUI="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
FABBRICA="$QUI/fabbrica-pacchetto.sh"

PASS=0
FALLITI=0
FALLITI_NOMI=()

# ------------------------------------------------------------- utilità ----

titolo() { printf '\n\033[1m═══ %s ═══\033[0m\n' "$*"; }
passo() { printf '\n\033[36m→ %s\033[0m\n' "$*"; }
info() { printf '    %s\n' "$*"; }

verifica() { # verifica <descrizione> <atteso> <ottenuto>
  if [[ "$2" == "$3" ]]; then
    printf '  \033[32m✓\033[0m %s\n' "$1"
    PASS=$((PASS + 1))
  else
    printf '  \033[31m✗ %s\033[0m\n      atteso:   %s\n      ottenuto: %s\n' "$1" "$2" "$3"
    FALLITI=$((FALLITI + 1))
    FALLITI_NOMI+=("$1")
  fi
}

verifica_contiene() { # verifica_contiene <descrizione> <ago> <pagliaio>
  if [[ "$3" == *"$2"* ]]; then
    printf '  \033[32m✓\033[0m %s\n' "$1"
    PASS=$((PASS + 1))
  else
    printf '  \033[31m✗ %s\033[0m\n      manca: %s\n      trovato: %s\n' "$1" "$2" "${3:0:400}"
    FALLITI=$((FALLITI + 1))
    FALLITI_NOMI+=("$1")
  fi
}

muori() {
  printf '\n\033[31mSTOP: %s\033[0m\n' "$*" >&2
  exit 1
}

schema_db() { sqlite3 "$DB" 'PRAGMA user_version' 2>/dev/null || echo '?'; }
conta_utenti() { sqlite3 "$DB" 'SELECT count(*) FROM users' 2>/dev/null || echo '?'; }
release_attiva() { basename "$(readlink -f "$LINK" 2>/dev/null || echo nessuna)"; }
conta_release() { find "$RELEASES" -mindepth 1 -maxdepth 1 -type d 2>/dev/null | wc -l; }
commit_vivo() {
  curl -s --max-time 5 "http://127.0.0.1:$PORT/health" 2>/dev/null |
    "${NODE_BIN:-/usr/bin/node}" -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{try{process.stdout.write(String(JSON.parse(s).commit??""))}catch{process.stdout.write("")}})' 2>/dev/null
}
id_di() { # id_di <pacchetto.tar.gz>
  tar -xzOf "$1" ./RELEASE.json 2>/dev/null |
    "${NODE_BIN:-/usr/bin/node}" -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{try{process.stdout.write(JSON.parse(s).id)}catch{process.stdout.write("")}})'
}

fabbrica() { # fabbrica <opzioni...> -> stampa il percorso del pacchetto
  local out
  out="$("$FABBRICA" "$BUONO" -o "$TMP" "$@" 2>/dev/null | grep -oE '/[^ ]+\.tar\.gz' | head -1)"
  [[ -n "$out" && -f "$out" ]] || muori "fabbrica-pacchetto.sh non ha prodotto niente (opzioni: $*)"
  printf '%s' "$out"
}

# ----------------------------------------------------------- argomenti ----

BUONO="${1:-}"
SCENARIO="${2:-tutti}"

[[ -n "$BUONO" ]] || muori "uso: sudo $0 <buono.tar.gz> [S1|S2|S3|S3b|S4|S4b|S5|tutti]"
[[ -f "$BUONO" ]] || muori "pacchetto non trovato: $BUONO"
[[ $EUID -eq 0 ]] || muori 'va eseguito come root (usa sudo)'
[[ -x "$FABBRICA" ]] || muori "manca $FABBRICA"
command -v sqlite3 >/dev/null || muori 'serve sqlite3 per verificare user_version e il conteggio utenti'
command -v "$UPDATE" >/dev/null || muori "$UPDATE non è installato: fai prima Pass 1 (RUNBOOK-BACKEND.md)"

TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
BUONO="$(cd "$(dirname "$BUONO")" && pwd)/$(basename "$BUONO")"

# =========================================================== S1 ============

s1() {
  titolo 'S1 — aggiornamenti ripetuti fino alla potatura'
  [[ -L "$LINK" ]] || muori "non risulta un'installazione (manca il symlink $LINK). Fai prima Pass 1."

  local schema0 utenti0 n
  schema0="$(schema_db)"
  utenti0="$(conta_utenti)"
  info "stato di partenza: schema $schema0, $utenti0 utenti, $(conta_release) release"

  for n in 1 2 3 4 5; do
    passo "aggiornamento $n di 5"
    local pkg id backup_prima backup_dopo
    pkg="$(fabbrica --nuovo-id)"
    id="$(id_di "$pkg")"
    backup_prima="$(find "$BACKUPS" -name '*.db' 2>/dev/null | wc -l)"

    if ! "$UPDATE" "$pkg" >"$TMP/s1.log" 2>&1; then
      sed 's/^/      /' "$TMP/s1.log"
      muori "l'aggiornamento $n è fallito, e non doveva"
    fi

    backup_dopo="$(find "$BACKUPS" -name '*.db' 2>/dev/null | wc -l)"
    verifica "agg. $n: la release attiva è quella nuova" "$id" "$(release_attiva)"
    verifica "agg. $n: /health risponde col commit nuovo" "${id##*.}" "$(commit_vivo)"
    verifica "agg. $n: è stato preso un backup del database" 'sì' "$([[ $backup_dopo -gt $backup_prima ]] && echo sì || echo no)"
    verifica "agg. $n: user_version invariato" "$schema0" "$(schema_db)"
    verifica "agg. $n: conteggio utenti invariato" "$utenti0" "$(conta_utenti)"
  done

  passo 'potatura'
  local rimaste
  rimaste="$(conta_release)"
  # KEEP_RELEASES=5, più la protezione esplicita su release attiva e precedente:
  # 5 è il valore atteso, 6 è accettabile quando la precedente sarebbe stata
  # potata ma è protetta.
  if [[ "$rimaste" -eq 5 || "$rimaste" -eq 6 ]]; then
    verifica 'sono rimaste 5 release (o 6 con la precedente protetta)' 'ok' 'ok'
  else
    verifica 'sono rimaste 5 release (o 6 con la precedente protetta)' '5 o 6' "$rimaste"
  fi
  info "release presenti: $(ls -1 "$RELEASES" | tr '\n' ' ')"
}

# =========================================================== S2 ============

s2() {
  titolo 'S2 — --activate: precedente, senza id, id inesistente'
  local prima out
  prima="$(release_attiva)"

  local esito
  passo '--activate senza id'
  if "$UPDATE" --activate >"$TMP/s2a.log" 2>&1; then esito=riuscito; else esito=errore; fi
  out="$(cat "$TMP/s2a.log")"
  verifica '--activate senza id esce con errore' 'errore' "$esito"
  verifica_contiene 'il messaggio spiega che serve un id (non muore in silenzio)' 'richiede' "$out"
  verifica 'la release attiva non è cambiata' "$prima" "$(release_attiva)"

  passo '--activate con un id inesistente'
  if "$UPDATE" --activate 1999-01-01.0000.nonesiste >"$TMP/s2b.log" 2>&1; then esito=riuscito; else esito=errore; fi
  out="$(cat "$TMP/s2b.log")"
  verifica '--activate con id inesistente esce con errore' 'errore' "$esito"
  verifica_contiene 'il messaggio nomina il percorso cercato' "$RELEASES/1999-01-01.0000.nonesiste" "$out"
  verifica 'la release attiva non è cambiata' "$prima" "$(release_attiva)"

  passo '--activate su una release precedente vera'
  local precedente
  precedente="$(ls -1 "$RELEASES" | sort -r | grep -v "^$prima\$" | head -1)"
  if [[ -z "$precedente" ]]; then
    info 'una sola release presente: esegui prima S1. Salto.'
    return
  fi
  info "torno a $precedente"
  if "$UPDATE" --activate "$precedente" >"$TMP/s2.log" 2>&1; then
    verifica 'il rollback manuale ha attivato la release precedente' "$precedente" "$(release_attiva)"
    verifica '/health risponde col commit della precedente' "${precedente##*.}" "$(commit_vivo)"
  else
    sed 's/^/      /' "$TMP/s2.log"
    verifica 'il rollback manuale riesce' 'riuscito' 'fallito'
  fi

  info "rimetto in linea $prima"
  "$UPDATE" --activate "$prima" >/dev/null 2>&1 ||
    info 'ATTENZIONE: non sono riuscito a rimettere la release di partenza, controlla a mano'
}

# =========================================================== S3 ============

s3() {
  titolo 'S3 — pacchetto in crash-loop → rollback automatico'
  local prima pkg out
  prima="$(release_attiva)"
  [[ -n "$prima" && "$prima" != nessuna ]] || muori 'nessuna release attiva: fai prima Pass 1'
  info "release attiva prima: $prima"

  pkg="$(fabbrica --nuovo-id --senza-dist)"
  passo "installo un pacchetto senza dist/index.js ($(basename "$pkg"))"
  out="$("$UPDATE" "$pkg" 2>&1)"

  verifica_contiene 'lo script dichiara il fallimento' 'AGGIORNAMENTO FALLITO' "$out"
  verifica_contiene 'il rollback automatico è RIUSCITO' 'ROLLBACK RIUSCITO' "$out"
  verifica 'il symlink è tornato alla release precedente' "$prima" "$(release_attiva)"
  verifica '/health risponde di nuovo col commit precedente' "${prima##*.}" "$(commit_vivo)"
  verifica 'il servizio è attivo' 'active' "$(systemctl is-active "$UNIT" 2>/dev/null)"

  # La regressione che il documento chiede di segnalare subito.
  if [[ "$out" == *'ROLLBACK FALLITO ANCHE LUI'* && "$(release_attiva)" == "$prima" ]]; then
    printf '\n\033[31m  REGRESSIONE SERIA:\033[0m «ROLLBACK FALLITO ANCHE LUI» mentre il symlink\n'
    printf '  è invece tornato a posto. È esattamente il difetto già corretto una volta\n'
    printf '  (il contatore di avvii falliti di systemd). Segnalalo subito.\n'
    FALLITI=$((FALLITI + 1))
    FALLITI_NOMI+=('S3: ROLLBACK FALLITO ANCHE LUI su un rollback in realtà riuscito')
  fi
}

# ========================================================== S3b ============

s3b() {
  titolo 'S3b — pacchetto senza il modulo nativo → rifiuto pulito'
  local prima release_prima pkg out schema_prima
  prima="$(release_attiva)"
  release_prima="$(conta_release)"
  schema_prima="$(schema_db)"

  pkg="$(fabbrica --nuovo-id --senza-build-sqlite)"
  passo "installo un pacchetto senza better-sqlite3/build ($(basename "$pkg"))"
  out="$("$UPDATE" "$pkg" 2>&1)"

  verifica_contiene 'il rifiuto nomina il modulo nativo' 'better-sqlite3' "$out"
  verifica 'NON è stato tentato nessuno scambio di symlink' 'no' "$([[ "$out" == *'AGGIORNAMENTO FALLITO'* ]] && echo sì || echo no)"
  verifica 'la release attiva è intatta' "$prima" "$(release_attiva)"
  verifica 'nessuna release è stata aggiunta' "$release_prima" "$(conta_release)"
  verifica 'lo schema del database è intatto' "$schema_prima" "$(schema_db)"
  verifica 'il servizio è rimasto attivo' 'active' "$(systemctl is-active "$UNIT" 2>/dev/null)"
}

# =========================================================== S4 ============

s4() {
  titolo 'S4 — schemaVersion abbassato → guardia forward-only'
  local prima pkg out release_prima
  prima="$(release_attiva)"
  release_prima="$(conta_release)"

  pkg="$(fabbrica --nuovo-id --schema 4)"
  passo "installo un pacchetto che dichiara schema 4 ($(basename "$pkg"))"
  out="$("$UPDATE" "$pkg" 2>&1)"

  verifica_contiene 'il rifiuto nomina lo schema' 'schema' "$out"
  verifica 'la release attiva è intatta' "$prima" "$(release_attiva)"
  verifica 'nessuna release è stata aggiunta' "$release_prima" "$(conta_release)"

  passo '--activate su una release con schema abbassato a mano'
  local bersaglio
  bersaglio="$(ls -1 "$RELEASES" | sort -r | grep -v "^$prima\$" | head -1)"
  if [[ -z "$bersaglio" ]]; then
    info 'serve almeno una seconda release: esegui prima S1. Salto questa metà.'
    return
  fi
  cp "$RELEASES/$bersaglio/RELEASE.json" "$TMP/s4-backup-release.json"
  "${NODE_BIN:-/usr/bin/node}" -e '
    const fs=require("node:fs"),p=process.argv[1];
    const r=JSON.parse(fs.readFileSync(p,"utf8")); r.schemaVersion=4;
    fs.writeFileSync(p, JSON.stringify(r,null,2)+"\n");
  ' "$RELEASES/$bersaglio/RELEASE.json"

  out="$("$UPDATE" --activate "$bersaglio" 2>&1)"
  verifica_contiene "--activate rifiuta la release a schema più basso" 'schema' "$out"
  verifica 'la release attiva è ancora quella di prima' "$prima" "$(release_attiva)"

  cp "$TMP/s4-backup-release.json" "$RELEASES/$bersaglio/RELEASE.json"
  info "RELEASE.json di $bersaglio ripristinato"
}

# ========================================================== S4b ============

s4b() {
  titolo 'S4b — release precedente a schema 4 + pacchetto rotto (il test di più alto valore)'
  local prima pkg out backup_json backup_db s4b_db
  prima="$(release_attiva)"
  [[ -n "$prima" && "$prima" != nessuna ]] || muori 'nessuna release attiva'

  # Non si può INSTALLARE un pacchetto a schema 4 (lo blocca la guardia di S4):
  # la release «precedente» va abbassata a mano dopo l'installazione.
  passo "abbasso a mano schemaVersion della release attiva ($prima) a 4"
  backup_json="$TMP/s4b-release.json"
  cp "$RELEASES/$prima/RELEASE.json" "$backup_json"
  "${NODE_BIN:-/usr/bin/node}" -e '
    const fs=require("node:fs"),p=process.argv[1];
    const r=JSON.parse(fs.readFileSync(p,"utf8")); r.schemaVersion=4;
    fs.writeFileSync(p, JSON.stringify(r,null,2)+"\n");
  ' "$RELEASES/$prima/RELEASE.json"

  pkg="$(fabbrica --nuovo-id --senza-dist)"
  passo "installo un pacchetto rotto: il rollback dovrebbe essere RIFIUTATO, non fallito"
  out="$("$UPDATE" "$pkg" 2>&1)"

  verifica_contiene 'compare il blocco «ROLLBACK AUTOMATICO NON ESEGUITO»' 'ROLLBACK AUTOMATICO NON ESEGUITO' "$out"
  verifica_contiene 'spiega che servono codice E database' 'codice E database' "$out"
  verifica_contiene 'avverte sulla perdita di dati dopo il backup' 'si perdono i dati' "$out"
  verifica_contiene 'stampa il comando che rimuove i file WAL' '-wal' "$out"

  # I CINQUE comandi vanno eseguiti PER DAVVERO: è il punto dello scenario.
  passo 'eseguo per davvero i cinque comandi di ripristino che ha stampato'
  backup_db="$(find "$BACKUPS" -name '*.db' -printf '%T@ %p\n' 2>/dev/null | sort -rn | head -1 | cut -d' ' -f2-)"
  if [[ -z "$backup_db" ]]; then
    verifica 'esiste un backup del database da ripristinare' 'sì' 'no'
    cp "$backup_json" "$RELEASES/$prima/RELEASE.json"
    return
  fi
  info "backup più recente: $backup_db"

  # Il backup ha user_version=5, ma la release che vogliamo riattivare dichiara
  # 4: --activate lo rifiuterebbe e sembrerebbe che la procedura sia rotta,
  # mentre sarebbe colpa del test. Serve un backup davvero a schema 4.
  # Abbassare user_version non corrompe niente: ogni gradino di migrate() è
  # protetto da un controllo sulle colonne, quindi la migrazione rigira a vuoto.
  s4b_db="$TMP/s4b-schema4.db"
  cp "$backup_db" "$s4b_db"
  sqlite3 "$s4b_db" 'PRAGMA user_version = 4'
  info "copia del backup portata a user_version=$(sqlite3 "$s4b_db" 'PRAGMA user_version')"

  systemctl stop "$UNIT"
  cp "$s4b_db" "$DB"
  rm -f "$DB-wal" "$DB-shm"
  chown runwaysurfer:runwaysurfer "$DB"
  out="$("$UPDATE" --activate "$prima" 2>&1)"

  verifica 'dopo il ripristino, --activate riattiva la release precedente' "$prima" "$(release_attiva)"
  verifica 'il servizio è tornato attivo' 'active' "$(systemctl is-active "$UNIT" 2>/dev/null)"
  verifica '/health risponde col commit della release ripristinata' "${prima##*.}" "$(commit_vivo)"
  # Il codice conosce lo schema 5 e il database è stato riportato a 4: all'avvio
  # deve rimigrare da sé fino a 5.
  verifica 'il servizio ha rimigrato il database a 5' '5' "$(schema_db)"
  if [[ "$(release_attiva)" != "$prima" ]]; then
    printf '      esito di --activate:\n%s\n' "$(echo "$out" | sed 's/^/      /')"
  fi

  cp "$backup_json" "$RELEASES/$prima/RELEASE.json"
  info "RELEASE.json di $prima ripristinato a schema reale"
}

# =========================================================== S5 ============

s5() {
  titolo 'S5 — enable --now PRIMA della prima installazione'
  printf '\n\033[33m  Questo scenario AZZERA l installazione: cancella %s.\033[0m\n' "$ROOT"
  printf '  Va eseguito per ultimo, e serve rifare Pass 1 dopo.\n'
  read -r -p '  Procedo? [scrivi AZZERA per confermare] ' risposta
  if [[ "$risposta" != AZZERA ]]; then
    info 'saltato.'
    return
  fi

  "$QUI/azzera.sh" --forza || muori 'azzeramento fallito'

  passo 'systemctl enable --now su un ambiente vuoto (deve fallire, il codice non c è)'
  systemctl enable --now "$UNIT" >/dev/null 2>&1 || true
  sleep 3
  info "stato del servizio: $(systemctl is-active "$UNIT" 2>/dev/null) / $(systemctl is-failed "$UNIT" 2>/dev/null)"
  info "avvii falliti registrati: $(systemctl show -p NRestarts --value "$UNIT" 2>/dev/null)"

  passo 'ora la prima installazione vera: NON deve essere bloccata dal limite di riavvii'
  local out
  out="$("$UPDATE" "$BUONO" 2>&1)"
  verifica 'la prima installazione riesce comunque' 'active' "$(systemctl is-active "$UNIT" 2>/dev/null)"
  verifica 'il symlink punta alla release del pacchetto' "$(id_di "$BUONO")" "$(release_attiva)"
  if [[ "$(systemctl is-active "$UNIT" 2>/dev/null)" != active ]]; then
    printf '%s\n' "$out" | tail -30 | sed 's/^/      /'
    printf '      \033[31mSe il motivo è «Start request repeated too quickly», il reset-failed\n'
    printf '      nello script non sta funzionando: è una regressione.\033[0m\n'
  fi
}

# ========================================================== driver ============

printf '\033[1mCollaudo Runway Surfer — Pass 2\033[0m\n'
printf 'pacchetto buono: %s\n' "$BUONO"
printf 'scenario:        %s\n' "$SCENARIO"

case "$SCENARIO" in
  S1 | s1) s1 ;;
  S2 | s2) s2 ;;
  S3 | s3) s3 ;;
  S3b | s3b) s3b ;;
  S4 | s4) s4 ;;
  S4b | s4b) s4b ;;
  S5 | s5) s5 ;;
  tutti)
    s1
    s2
    s3
    s3b
    s4
    s4b
    s5
    ;;
  *) muori "scenario non riconosciuto: $SCENARIO (S1|S2|S3|S3b|S4|S4b|S5|tutti)" ;;
esac

titolo 'Riepilogo'
printf '  verifiche superate: %d\n  fallite:            %d\n' "$PASS" "$FALLITI"
if [[ $FALLITI -gt 0 ]]; then
  printf '\n  Non superate:\n'
  printf '    · %s\n' "${FALLITI_NOMI[@]}"
  printf '\n  Il log completo degli aggiornamenti è in %s/update.log\n' "$ROOT"
  exit 1
fi
printf '\n\033[32mTutti i criteri di successo sono stati verificati.\033[0m\n'
printf 'Ricorda: ripeti S3, S4b e S5, e per ognuno chiediti se è passato per il\n'
printf 'motivo giusto — un 226/NAMESPACE letto come crash-loop farebbe «passare»\n'
printf 'S3 senza aver provato niente.\n'
