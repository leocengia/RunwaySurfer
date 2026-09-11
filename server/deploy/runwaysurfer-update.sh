#!/usr/bin/env bash
# Aggiornamento del backend Runway Surfer da un pacchetto offline.
#
# Cosa fa, in una riga: verifica il pacchetto, fa il backup del database, scambia
# un symlink, riavvia, e se il servizio nuovo non risponde con la versione
# attesa torna da solo alla release precedente.
#
# Cosa NON fa: non scarica niente (il rack può essere offline), non installa la
# unit systemd, non tocca /etc/runwaysurfer/ né il database — tranne per
# copiarlo nel backup.
#
# Installazione:
#   sudo install -m 0755 runwaysurfer-update.sh /usr/local/sbin/runwaysurfer-update
#
# Uso:
#   sudo runwaysurfer-update <pacchetto.tar.gz>       aggiorna
#   sudo runwaysurfer-update --dry-run <pacchetto>    solo controlli, non tocca niente
#   sudo runwaysurfer-update --list                   release presenti e quella attiva
#   sudo runwaysurfer-update --activate <release-id>  rollback manuale
#
# Il pacchetto lo produce la CI (artifact `runway-surfer-server-bundle`) insieme
# al suo file .sha256: copiare entrambi sulla macchina.
set -euo pipefail

ROOT=/opt/runwaysurfer
RELEASES="$ROOT/releases"
LINK="$ROOT/server" # il symlink che la unit systemd usa come WorkingDirectory
BACKUPS="$ROOT/backups"
LOGFILE="$ROOT/update.log"
ENVFILE=/etc/runwaysurfer/runwaysurfer.env
UNIT=runwaysurfer
SERVICE_USER=runwaysurfer
KEEP_RELEASES=5
HEALTH_TIMEOUT=60

# Lo STESSO Node che systemd esegue: la unit cabla /usr/bin/node in ExecStart.
# Invocare `node` nudo misura quello che capita per primo nel PATH di root — con
# un nvm o uno snap installati è un binario diverso, e allora il controllo
# dell'ABI qui sotto certifica una major che il servizio non userà mai, mentre
# read_user_version carica better-sqlite3 con l'ABI sbagliato, non ci riesce e
# restituisce «sconosciuta», che disattiva in silenzio la guardia sullo schema.
NODE_BIN=/usr/bin/node

DRY_RUN=0
SKIP_CHECKSUM=0
MODE=update
BUNDLE=""
TARGET=""

# Stato per il rollback: popolato mentre si procede.
PREV=""
SWITCHED=0
BACKUP=""
NEW_ID=""

# ---------------------------------------------------------------- utilità ----

# Tutto a schermo E nel log: quando qualcosa va storto serve poter rileggere
# l'intera sessione, non ricordarsela.
LOG_READY=0
log() {
  local line
  line="$(printf '%s  %s' "$(date -Is)" "$*")"
  printf '%s\n' "$line" >&2
  # Sul file solo quando la cartella esiste. Prima c'era un `| tee -a`, ma due
  # `die` girano PRIMA del mkdir più sotto: il tee falliva, e sotto
  # `set -euo pipefail` una pipeline che fallisce fa ritornare log() diverso da
  # zero — cioè poteva interrompere lo script a metà, non solo stampare rumore.
  if [[ $LOG_READY -eq 1 ]]; then printf '%s\n' "$line" >>"$LOGFILE" 2>/dev/null || true; fi
}

die() {
  log "ERRORE: $*"
  exit 1
}

# Lettura di un campo da un JSON senza dipendere da jq, che su una Debian
# minimale non c'è. Node è un requisito del servizio, quindi c'è per definizione.
json_field() {
  "$NODE_BIN" -e '
    const fs = require("node:fs");
    const data = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
    const value = data[process.argv[2]];
    process.stdout.write(value === undefined || value === null ? "" : String(value));
  ' "$1" "$2"
}

# Legge PORT e la presenza del TLS dall'env file, per sapere dove interrogare
# /health. Stessa regola di config.ts: 443 con TLS, 8787 senza.
env_value() {
  [[ -r "$ENVFILE" ]] || return 0
  sed -n "s/^[[:space:]]*$1[[:space:]]*=[[:space:]]*//p" "$ENVFILE" | tail -n 1 | tr -d '"'"'"'\r'
}

health_url() {
  local port scheme
  if [[ -n "$(env_value TLS_CERT_PATH)" && -n "$(env_value TLS_KEY_PATH)" ]]; then
    scheme=https
    port="${1:-443}"
  else
    scheme=http
    port="${1:-8787}"
  fi
  printf '%s://127.0.0.1:%s/health' "$scheme" "$port"
}

fetch_health() {
  # -k: ci si collega a 127.0.0.1 mentre il certificato è emesso per l'hostname
  # pubblico, quindi il nome non combacia per costruzione. Qui non stiamo
  # verificando il certificato, stiamo chiedendo al servizio chi è.
  curl -sk --max-time 5 "$(health_url "$(env_value PORT)")" 2>/dev/null || true
}

# Aspetta che il servizio risponda, e che risponda con il commit ATTESO. «Il
# processo è su» non basta: dopo uno scambio di symlink andato a metà il
# processo può essere ancora quello vecchio.
wait_for_health() {
  local expect="$1" i body got pid_before pid_now
  pid_before="$(systemctl show -p MainPID --value "$UNIT" 2>/dev/null || echo 0)"
  for ((i = 0; i < HEALTH_TIMEOUT; i++)); do
    body="$(fetch_health)"
    if [[ -n "$body" ]]; then
      got="$(printf '%s' "$body" | "$NODE_BIN" -e '
        let s = ""; process.stdin.on("data", (d) => (s += d)).on("end", () => {
          try { process.stdout.write(String(JSON.parse(s).commit ?? "")); } catch { process.stdout.write(""); }
        });
      ')"
      if [[ -z "$expect" || "$got" == "$expect" ]]; then
        # Anche con un health OK: se il processo è cambiato durante l'attesa, il
        # servizio è in crash-loop e ha solo risposto fra due morti.
        pid_now="$(systemctl show -p MainPID --value "$UNIT" 2>/dev/null || echo 0)"
        if [[ "$pid_before" != "0" && "$pid_now" != "$pid_before" ]]; then
          log "il servizio si è riavviato durante il controllo (PID $pid_before → $pid_now): è in crash-loop"
          return 1
        fi
        log "il servizio risponde, commit=$got"
        return 0
      fi
      log "risponde ma con il commit sbagliato: atteso $expect, trovato ${got:-vuoto}"
    fi
    if [[ "$(systemctl is-active "$UNIT" 2>/dev/null || true)" == "failed" ]]; then
      log "systemd ha dichiarato il servizio 'failed' (ha smesso di ritentare)"
      return 1
    fi
    sleep 1
  done
  log "nessuna risposta valida entro ${HEALTH_TIMEOUT}s"
  return 1
}

db_path() {
  local from_env
  from_env="$(env_value RUNWAYSURFER_DB_PATH)"
  printf '%s' "${from_env:-/var/lib/runwaysurfer/runwaysurfer.db}"
}

# user_version del database VIVO, letta in sola lettura con il better-sqlite3
# del pacchetto: nessuna dipendenza dal CLI sqlite3, e nessun rischio di
# scriverci.
read_user_version() {
  local modules="$1" db
  db="$(db_path)"
  [[ -f "$db" ]] || {
    printf '0'
    return 0
  }
  NODE_PATH="$modules" "$NODE_BIN" -e '
    const Database = require("better-sqlite3");
    const d = new Database(process.argv[1], { readonly: true, fileMustExist: true });
    process.stdout.write(String(d.pragma("user_version", { simple: true })));
    d.close();
  ' "$db" 2>/dev/null || printf 'sconosciuta'
}

active_release() {
  [[ -L "$LINK" ]] && basename "$(readlink -f "$LINK")" || true
}

# Riavvio del servizio, azzerando prima il contatore di avvii falliti.
#
# NON è una precauzione teorica: systemd rifiuta `restart` per
# ~StartLimitIntervalSec dopo che un servizio ha esaurito StartLimitBurst, e il
# ROLLBACK AUTOMATICO parte esattamente dopo cinque avvii falliti. Senza questa
# riga, il rollback si beccava «Start request repeated too quickly», lo perdeva
# dentro un `|| true` e dichiarava «ROLLBACK FALLITO ANCHE LUI. Servizio giù.» su
# un rollback che aveva già rimesso il symlink a posto e che sarebbe riuscito
# aspettando un minuto. È la rete di sicurezza su cui si regge tutta la procedura.
# `reset-failed` è un no-op se il servizio non è in stato failed.
restart_unit() {
  systemctl reset-failed "$UNIT" 2>/dev/null || true
  systemctl restart "$UNIT"
}

# rename(2) su un symlink è ATOMICO: `server` punta al vecchio o al nuovo, mai a
# niente. Un Ctrl-C proprio qui non lascia il servizio senza codice.
swap_link() {
  ln -sfn "releases/$1" "$ROOT/.server.new"
  mv -T "$ROOT/.server.new" "$LINK"
}

# ------------------------------------------------------------- argomenti ----

while [[ $# -gt 0 ]]; do
  case "$1" in
    --dry-run) DRY_RUN=1 ;;
    --senza-checksum) SKIP_CHECKSUM=1 ;;
    --list) MODE=list ;;
    --activate)
      MODE=activate
      # Lo shift va fatto SOLO se l'id c'è davvero: con `--activate` e nulla
      # dopo, uno shift su zero argomenti restituisce errore e `set -e`
      # ucciderebbe lo script senza stampare niente. Il controllo su TARGET
      # vuoto sta più sotto, quando il file di log esiste e può registrarlo.
      if [[ $# -ge 2 ]]; then
        TARGET="$2"
        shift
      fi
      ;;
    -h | --help)
      sed -n '2,22p' "$0" | sed 's/^# \{0,1\}//'
      exit 0
      ;;
    -*) die "opzione non riconosciuta: $1" ;;
    *) BUNDLE="$1" ;;
  esac
  shift
done

[[ $EUID -eq 0 ]] || die "va eseguito come root (usa sudo)."
mkdir -p "$RELEASES" "$BACKUPS"
touch "$LOGFILE"
LOG_READY=1

# Qui e non fra i controlli preliminari dell'aggiornamento: anche --list e
# --activate leggono i RELEASE.json e lo schema del database passando da Node.
[[ -x "$NODE_BIN" ]] || die "$NODE_BIN non trovato. Node va installato da apt/NodeSource: la unit systemd lo cabla in ExecStart, quindi un Node da nvm o snap non basta (vedi RUNBOOK-BACKEND.md, «Prima installazione», passo 2)."

# ------------------------------------------------------------------ list ----

if [[ "$MODE" == list ]]; then
  ACTIVE="$(active_release)"
  RUNNING="$(fetch_health | "$NODE_BIN" -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{try{const j=JSON.parse(s);process.stdout.write(`${j.version} (${j.commit})`)}catch{process.stdout.write("non risponde")}})' 2>/dev/null || echo "non risponde")"
  echo "Release installate in $RELEASES:"
  for dir in "$RELEASES"/*/; do
    [[ -d "$dir" ]] || continue
    id="$(basename "$dir")"
    marker="  "
    [[ "$id" == "$ACTIVE" ]] && marker="* "
    if [[ -f "$dir/RELEASE.json" ]]; then
      printf '%s%s  (versione %s, costruita %s)\n' "$marker" "$id" \
        "$(json_field "$dir/RELEASE.json" version)" "$(json_field "$dir/RELEASE.json" builtAt)"
    else
      printf '%s%s  (senza RELEASE.json)\n' "$marker" "$id"
    fi
  done
  echo ""
  echo "* = attiva secondo il symlink        in esecuzione ora: $RUNNING"
  echo "Schema del database: $(read_user_version "$LINK/node_modules")"
  exit 0
fi

# -------------------------------------------------------------- activate ----

if [[ "$MODE" == activate ]]; then
  [[ -n "$TARGET" ]] || die "--activate richiede l'id di una release (vedi --list)."
  [[ -d "$RELEASES/$TARGET" ]] || die "release non trovata: $RELEASES/$TARGET"

  # Tollerante come in rollback(): 0000.preesistente è un bersaglio legittimo di
  # --activate e non ha un RELEASE.json. Vuoto qui significa «schema ignoto»,
  # che la guardia sotto tratta come «non bloccare».
  TARGET_SCHEMA="$(json_field "$RELEASES/$TARGET/RELEASE.json" schemaVersion 2>/dev/null || true)"
  DB_SCHEMA="$(read_user_version "$RELEASES/$TARGET/node_modules" || true)"
  if [[ -n "$TARGET_SCHEMA" && "$DB_SCHEMA" =~ ^[0-9]+$ ]] && ((TARGET_SCHEMA < DB_SCHEMA)); then
    die "la release $TARGET conosce lo schema $TARGET_SCHEMA ma il database è già al $DB_SCHEMA: si rifiuterebbe di partire. Serve anche ripristinare un backup del database (vedi $BACKUPS)."
  fi

  log "attivazione manuale della release $TARGET"
  PREV="$(active_release)"
  swap_link "$TARGET"
  restart_unit
  if wait_for_health "$(json_field "$RELEASES/$TARGET/RELEASE.json" shortCommit 2>/dev/null || true)"; then
    log "release $TARGET attiva."
    exit 0
  fi
  die "la release $TARGET non risponde. Symlink lasciato su $TARGET; controlla: journalctl -u $UNIT -n 100"
fi

# ---------------------------------------------------------------- update ----

[[ -n "$BUNDLE" ]] || die "manca il pacchetto. Uso: sudo runwaysurfer-update <pacchetto.tar.gz>"
[[ -r "$BUNDLE" ]] || die "pacchetto non leggibile: $BUNDLE"

log "=== aggiornamento da $BUNDLE (dry-run=$DRY_RUN) ==="

# 1. Checksum. L'errore vero non è un pacchetto manomesso, è un file troncato da
#    uno SCP interrotto o da una chiavetta difettosa.
if [[ $SKIP_CHECKSUM -eq 0 ]]; then
  [[ -r "$BUNDLE.sha256" ]] || die "manca $BUNDLE.sha256 (scaricalo insieme al pacchetto, oppure usa --senza-checksum se sai cosa stai facendo)."
  (cd "$(dirname "$BUNDLE")" && sha256sum -c "$(basename "$BUNDLE").sha256" >/dev/null) ||
    die "checksum NON corrispondente: il pacchetto è incompleto o corrotto. Ricopialo."
  log "checksum verificato"
else
  log "ATTENZIONE: verifica del checksum saltata su richiesta"
fi

# 2. Il timbro della release si legge dal tar senza estrarre nulla.
STAMP="$(mktemp)"
# Ripulisce anche lo staging: dopo un `die` successivo all'estrazione (per
# esempio il controllo del modulo nativo) restavano a terra ~130 MB fino alla
# volta dopo. STAGING è vuota finché non viene definita, quindi il test regge.
# La forma `if` e non `[[ … ]] && rm`: un test falso come ultimo comando del trap
# restituirebbe non-zero proprio mentre lo script sta uscendo.
trap 'rm -f "$STAMP"; if [[ -n "${STAGING:-}" && -d "${STAGING:-}" ]]; then rm -rf "$STAGING"; fi' EXIT
tar -xzOf "$BUNDLE" ./RELEASE.json >"$STAMP" 2>/dev/null ||
  tar -xzOf "$BUNDLE" RELEASE.json >"$STAMP" 2>/dev/null ||
  die "il pacchetto non contiene RELEASE.json: non è un pacchetto Runway Surfer."

NEW_ID="$(json_field "$STAMP" id)"
NEW_COMMIT="$(json_field "$STAMP" shortCommit)"
NEW_SCHEMA="$(json_field "$STAMP" schemaVersion)"
NEW_ABI="$(json_field "$STAMP" nodeAbi)"
NEW_ARCH="$(json_field "$STAMP" arch)"
[[ -n "$NEW_ID" ]] || die "RELEASE.json senza campo 'id'."
log "pacchetto: release $NEW_ID, versione $(json_field "$STAMP" version), schema $NEW_SCHEMA"

# 3. Controlli preliminari: tutti quelli che possono far fallire l'avvio, PRIMA
#    di toccare qualunque cosa.
systemctl cat "$UNIT" >/dev/null 2>&1 || die "la unit systemd '$UNIT' non è installata. Prima installazione: vedi deploy/runwaysurfer.service."
[[ -s "$ENVFILE" ]] || die "file di configurazione assente o vuoto: $ENVFILE"
# Senza questo controllo, un utente di servizio mancante si manifesta più sotto
# come «il certificato non è leggibile», incolpando i permessi invece della causa.
id -u "$SERVICE_USER" >/dev/null 2>&1 ||
  die "l'utente di servizio '$SERVICE_USER' non esiste. Prima installazione: sudo useradd --system --no-create-home --shell /usr/sbin/nologin $SERVICE_USER (vedi deploy/runwaysurfer.service)."

# Prima installazione senza password di bootstrap: il servizio partirebbe e
# /health risponderebbe, ma la dashboard resterebbe inaccessibile con una sola
# riga [auth] nel journal. È l'unico posto dove fermarsi non costa nulla — farlo
# diventare un errore d'avvio bloccherebbe invece l'installazione.
if [[ ! -f "$(db_path)" && -z "$(env_value ADMIN_BOOTSTRAP_PASSWORD)" ]]; then
  die "prima installazione con ADMIN_BOOTSTRAP_PASSWORD vuota in $ENVFILE: il servizio partirebbe e /health risponderebbe, ma la dashboard resterebbe INACCESSIBILE fino a un riavvio con la variabile impostata. Impostala e riprova."
fi

HOST_ABI="$("$NODE_BIN" -p process.versions.modules)"
HOST_ARCH="$("$NODE_BIN" -p process.arch)"
[[ -z "$NEW_ABI" || "$NEW_ABI" == "$HOST_ABI" ]] ||
  die "il pacchetto è compilato per l'ABI Node $NEW_ABI, questa macchina ha $HOST_ABI ($("$NODE_BIN" -p process.version)). Serve un pacchetto costruito per questo Node, oppure riportare Node alla major precedente."
[[ -z "$NEW_ARCH" || "$NEW_ARCH" == "$HOST_ARCH" ]] ||
  die "il pacchetto è per architettura $NEW_ARCH, questa macchina è $HOST_ARCH."

# TLS: il servizio gira come utente non privilegiato e i certificati sono in
# ReadOnlyPaths. Un certificato leggibile da root ma non da lui è un avvio
# fallito, e il messaggio arriverebbe solo dal journal.
for var in TLS_CERT_PATH TLS_KEY_PATH; do
  path="$(env_value "$var")"
  if [[ -n "$path" ]]; then
    # runuser e non sudo: sudo NON è installato su un'installazione minimale dove
    # è stata impostata una password di root, e mancherebbe proprio nel punto in
    # cui il messaggio deve essere chiaro.
    runuser -u "$SERVICE_USER" -- test -r "$path" ||
      die "$var punta a $path, che l'utente $SERVICE_USER non può leggere. Rilancia il deploy hook del certificato (vedi deploy/tls-deploy-hook.sh)."
  fi
done

# Spazio: il pacchetto scompattato due volte (staging + release) più il backup.
BUNDLE_SIZE_KB=$(($(stat -c %s "$BUNDLE") / 1024))
NEED_KB=$((BUNDLE_SIZE_KB * 8 + 51200))
AVAIL_KB=$(df --output=avail -k "$ROOT" | tail -1 | tr -d ' ')
((AVAIL_KB > NEED_KB)) || die "spazio insufficiente su $ROOT: servono ~${NEED_KB}KB, disponibili ${AVAIL_KB}KB."

PREV="$(active_release)"
log "release attiva ora: ${PREV:-nessuna}"

# Estrazione in staging: serve anche ai controlli che richiedono i file.
STAGING="$RELEASES/.staging-$NEW_ID"
rm -rf "$RELEASES"/.staging-*
mkdir -p "$STAGING"
# --no-same-owner e chown: per il superutente GNU tar conserva di DEFAULT l'uid
# registrato nell'archivio, e l'archivio è creato dall'utente `runner` della CI
# (uid 1001) — tipicamente il primo utente umano di una macchina Linux. Senza
# queste due righe la release finisce sua, e un utente locale può riscrivere
# l'applicativo in esecuzione: l'opposto di quanto dichiara la unit.
tar -xzf "$BUNDLE" -C "$STAGING" --no-same-owner
chown -R root:root "$STAGING" ||
  die "non riesco a rendere root la proprietaria di $STAGING. È una proprietà di sicurezza, non un dettaglio: il codice in esecuzione non deve essere scrivibile da un utente non privilegiato. Non proseguo."
log "pacchetto estratto in staging"

# Il controllo che vale davvero sull'ABI: il modulo nativo si carica o no.
"$NODE_BIN" -e "require('$STAGING/node_modules/better-sqlite3')" 2>/dev/null ||
  die "il modulo nativo better-sqlite3 del pacchetto non si carica con questo Node ($("$NODE_BIN" -p process.version)). Il pacchetto non è utilizzabile su questa macchina."
log "modulo nativo verificato"

# Schema: la build in arrivo deve conoscere almeno quello del database.
DB_SCHEMA="$(read_user_version "$STAGING/node_modules")"
if [[ "$DB_SCHEMA" =~ ^[0-9]+$ && -n "$NEW_SCHEMA" ]]; then
  if ((NEW_SCHEMA < DB_SCHEMA)); then
    rm -rf "$STAGING"
    die "il database è allo schema $DB_SCHEMA ma questo pacchetto conosce solo fino al $NEW_SCHEMA: è una release PRECEDENTE a quella che ha migrato il database, e si rifiuterebbe di partire. Per tornare indietro serve anche ripristinare un backup del database (vedi $BACKUPS e docs/RUNBOOK-BACKEND.md)."
  fi
  if ((NEW_SCHEMA > DB_SCHEMA)); then
    # Discriminato sul FILE e non sul numero: un database pre-versioning esiste
    # davvero a user_version 0 e deve ancora ricevere l'avviso. Alla prima
    # installazione, invece, «migrazione irreversibile» è solo allarmismo.
    if ((DB_SCHEMA == 0)) && [[ ! -f "$(db_path)" ]]; then
      log "prima installazione: il database verrà creato allo schema $NEW_SCHEMA al primo avvio."
    else
      log "NOTA: questo aggiornamento migrerà il database dallo schema $DB_SCHEMA al $NEW_SCHEMA. Il rollback automatico NON potrà tornare indietro da solo."
    fi
  fi
else
  # `sconosciuta` (database illeggibile, o better-sqlite3 che non si carica) fa
  # SALTARE la guardia forward-only qui sopra. Non è fatale — il servizio dirà la
  # sua all'avvio con una riga [db] — ma deve essere visibile, non silenzioso.
  log "AVVISO: non ho potuto leggere la versione di schema del database ($DB_SCHEMA): la verifica di compatibilità è stata SALTATA. Se questa è una release precedente, il servizio si rifiuterà di partire."
fi

# La unit del pacchetto è cambiata? Non la si installa a sorpresa: si segnala.
if [[ -f "$STAGING/deploy/runwaysurfer.service" ]]; then
  if ! systemctl cat "$UNIT" | tail -n +2 | diff -q - "$STAGING/deploy/runwaysurfer.service" >/dev/null 2>&1; then
    log "AVVISO: la unit systemd del pacchetto differisce da quella installata. Non la installo io. Differenze:"
    systemctl cat "$UNIT" | tail -n +2 | diff - "$STAGING/deploy/runwaysurfer.service" | head -40 | tee -a "$LOGFILE" >&2 || true
  fi
fi

if [[ $DRY_RUN -eq 1 ]]; then
  rm -rf "$STAGING"
  log "--dry-run: tutti i controlli superati, niente è stato modificato."
  exit 0
fi

# 4. Backup del database. VACUUM INTO produce una copia coerente a servizio
#    acceso; il fallback copia i tre file WAL insieme, perché prendere solo il
#    .db dà un backup incompleto e apparentemente valido.
DB="$(db_path)"
if [[ -f "$DB" ]]; then
  BACKUP="$BACKUPS/runwaysurfer-pre-$NEW_ID.db"
  # VACUUM INTO si RIFIUTA di scrivere su un file che esiste già, e un .part
  # resta lì ogni volta che un tentativo precedente è stato interrotto a metà.
  # Senza questa riga il backup fallisce, e siccome `A && B` sotto `set -e`
  # interrompe lo script senza passare da die(), l'aggiornamento si fermerebbe
  # qui senza un messaggio che dica perché.
  rm -f "$BACKUP.part"
  if command -v sqlite3 >/dev/null 2>&1; then
    sqlite3 "$DB" "VACUUM INTO '$BACKUP.part'" ||
      die "backup del database fallito (sqlite3 VACUUM INTO '$BACKUP.part'). Non proseguo: aggiornare senza una copia del database non è recuperabile."
  else
    NODE_PATH="$STAGING/node_modules" "$NODE_BIN" -e '
      const Database = require("better-sqlite3");
      const d = new Database(process.argv[1], { readonly: true, fileMustExist: true });
      d.exec(`VACUUM INTO ${JSON.stringify(process.argv[2])}`);
      d.close();
    ' "$DB" "$BACKUP.part" ||
      die "backup del database fallito (better-sqlite3 VACUUM INTO '$BACKUP.part'). Non proseguo: aggiornare senza una copia del database non è recuperabile."
  fi
  mv -f "$BACKUP.part" "$BACKUP" || die "backup creato ma non rinominabile in $BACKUP."
  log "backup del database: $BACKUP ($(($(stat -c %s "$BACKUP") / 1024)) KB)"
else
  log "nessun database da salvare (prima installazione?)"
fi

# 5. Promozione dello staging a release.
if [[ -d "$RELEASES/$NEW_ID" ]]; then
  log "la release $NEW_ID era già presente: la sostituisco"
  # `:?` e non `$NEW_ID` nudo: gira come root, e con la variabile vuota questo
  # sarebbe `rm -rf /opt/runwaysurfer/releases/`. NEW_ID è già validato sopra,
  # ma su una riga simile la ridondanza costa un carattere.
  rm -rf "$RELEASES/${NEW_ID:?}"
fi
mv -T "$STAGING" "$RELEASES/$NEW_ID"

# Prima installazione fatta a mano: `server` è una directory vera, non un
# symlink. La si sposta dentro releases/ e diventa il bersaglio di rollback —
# non la si butta.
if [[ -d "$LINK" && ! -L "$LINK" ]]; then
  log "trovata un'installazione preesistente in $LINK: la sposto in releases/0000.preesistente"
  rm -rf "$RELEASES/0000.preesistente"
  mv -T "$LINK" "$RELEASES/0000.preesistente"
  PREV=0000.preesistente
fi

# ------------------------------------------------------------- rollback ----

rollback() {
  log "AGGIORNAMENTO FALLITO: $1"
  if [[ $SWITCHED -eq 0 || -z "$PREV" ]]; then
    log "niente da annullare (il symlink non era ancora stato scambiato)."
    exit 1
  fi

  local prev_schema now_schema
  # `|| true` obbligatorio: PREV può essere 0000.preesistente, che questo stesso
  # script crea più sotto da un'installazione fatta a mano e che NON ha un
  # RELEASE.json. Senza, l'assegnazione fallisce, `set -e` uccide la funzione, e
  # il rollback automatico si interrompe esattamente quando serve. Un valore non
  # numerico non è un problema: la guardia qui sotto lo tratta come «non
  # bloccare» e si ricade sul rollback normale, che è il comportamento giusto.
  prev_schema="$(json_field "$RELEASES/$PREV/RELEASE.json" schemaVersion 2>/dev/null || true)"
  # Ri-letto: la build nuova può aver già migrato il database.
  now_schema="$(read_user_version "$RELEASES/$NEW_ID/node_modules" || true)"

  if [[ "$prev_schema" =~ ^[0-9]+$ && "$now_schema" =~ ^[0-9]+$ ]] && ((prev_schema < now_schema)); then
    cat <<TXT | tee -a "$LOGFILE" >&2

ROLLBACK AUTOMATICO NON ESEGUITO — sarebbe peggio del guasto.

Il database è già stato migrato allo schema $now_schema; la release precedente
($PREV) conosce solo lo schema $prev_schema e si rifiuterebbe di partire,
restando in restart-loop.

Il symlink resta su $NEW_ID e il servizio è FERMO o IN ERRORE.

Per tornare indietro davvero servono codice E database, in quest'ordine:

  sudo systemctl stop $UNIT
  sudo cp $BACKUP $(db_path)
  sudo rm -f $(db_path)-wal $(db_path)-shm
  sudo chown $SERVICE_USER:$SERVICE_USER $(db_path)
  sudo runwaysurfer-update --activate $PREV

ATTENZIONE: si perdono i dati scritti dopo il backup — richieste, feedback e
sessioni. Chiama Leonardo (cengia.l@aviationsrl.it, +39 328 052 1769) prima di
eseguirli.

I file -wal e -shm vanno rimossi: lasciarli farebbe replicare a SQLite un WAL
appartenente a un altro database, che è la corruzione silenziosa classica.
TXT
    exit 1
  fi

  log "rollback: torno a $PREV"
  swap_link "$PREV"
  restart_unit || true
  if wait_for_health "$(json_field "$RELEASES/$PREV/RELEASE.json" shortCommit 2>/dev/null || true)"; then
    log "ROLLBACK RIUSCITO — la release precedente è in linea. Backup del database: ${BACKUP:-nessuno}"
  else
    log "ROLLBACK FALLITO ANCHE LUI. Servizio giù. Backup: ${BACKUP:-nessuno}. Guarda: journalctl -u $UNIT -n 200"
  fi
  exit 1
}

# 6. Scambio, riavvio, verifica.
swap_link "$NEW_ID"
SWITCHED=1
log "symlink $LINK → releases/$NEW_ID"

restart_unit || rollback "systemctl restart ha restituito un errore"
wait_for_health "$NEW_COMMIT" || rollback "il servizio non risponde con il commit $NEW_COMMIT"

# 7. Potatura: si tengono le ultime N release più quella attiva e la precedente.
#
# ATTENZIONE: `sort -r` è LESSICOGRAFICO, non cronologico. Regge perché gli id
# della CI iniziano con la data (AAAA-MM-GG.NNNN.commit); un id fabbricato a
# mano senza quel prefisso farebbe potare la release sbagliata.
# shellcheck disable=SC2011  # gli id sono generati dalla CI: niente spazi né a capo
mapfile -t OLD < <(ls -1d "$RELEASES"/*/ 2>/dev/null | xargs -r -n1 basename | sort -r | tail -n +$((KEEP_RELEASES + 1)))
for id in "${OLD[@]:-}"; do
  [[ -n "$id" && "$id" != "$NEW_ID" && "$id" != "$PREV" ]] || continue
  log "rimuovo la release vecchia $id"
  rm -rf "$RELEASES/${id:?}"
done

log "=== AGGIORNAMENTO COMPLETATO: release $NEW_ID, commit $NEW_COMMIT ==="
log "release precedente conservata: ${PREV:-nessuna} (rollback: sudo runwaysurfer-update --activate ${PREV:-<id>})"

# Lo script NON abilita la unit da sé: il suo contratto dichiarato è «non installa
# la unit systemd», e la regola sudoers concordata col CED gli dà root per questo
# solo binario — allargare in silenzio ciò che tocca sarebbe un cambio di ambito.
# Ma un servizio che gira e non è abilitato non sopravvive a un riavvio della
# macchina, e nessuno se ne accorge finché la macchina non si riavvia.
if [[ "$(systemctl is-enabled "$UNIT" 2>/dev/null || true)" != enabled ]]; then
  log "AVVISO: la unit NON è abilitata all'avvio: dopo un riavvio della macchina il servizio non ripartirà. Correggi con: sudo systemctl enable $UNIT"
fi
