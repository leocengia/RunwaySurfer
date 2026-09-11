#!/usr/bin/env bash
#
# Pass 0 del collaudo: le differenze fra WSL2 e una Ubuntu su ferro che possono
# far fallire uno scenario PER IL MOTIVO SBAGLIATO.
#
# Non tocca niente: solo controlli. Va eseguito PRIMA della prima installazione,
# e di nuovo ogni volta che un esito sembra assurdo — metà delle stranezze di un
# collaudo in WSL sono in questa lista.
#
# Uso:  sudo deploy/collaudo/00-preflight.sh
#
set -euo pipefail

ENVFILE=/etc/runwaysurfer/runwaysurfer.env
ROOT=/opt/runwaysurfer
UNIT=runwaysurfer
NODE_BIN=/usr/bin/node
PORT_MOCK=8787

FAIL=0
WARN=0

ok() { printf '  \033[32mOK\033[0m    %s\n' "$*"; }
ko() {
  printf '  \033[31mBLOCCO\033[0m %s\n' "$*"
  FAIL=$((FAIL + 1))
}
nb() {
  printf '  \033[33mNOTA\033[0m  %s\n' "$*"
  WARN=$((WARN + 1))
}
titolo() { printf '\n\033[1m%s\033[0m\n' "$*"; }

IS_WSL=0
if grep -qiE 'microsoft|wsl' /proc/sys/kernel/osrelease 2>/dev/null; then IS_WSL=1; fi

printf '\033[1mPass 0 — preflight collaudo Runway Surfer\033[0m\n'
printf 'ambiente: %s\n' "$([[ $IS_WSL -eq 1 ]] && echo 'WSL2' || echo 'Linux nativo')"

# --------------------------------------------------------------- 0. base ----

titolo '0. Sistema di base'

if [[ -r /etc/os-release ]]; then
  # shellcheck disable=SC1091  # file di sistema, non nel repo
  . /etc/os-release
  if [[ "${VERSION_ID:-}" == "24.04" ]]; then
    ok "Ubuntu ${VERSION_ID} — combacia con il runner della CI"
  else
    nb "distribuzione ${PRETTY_NAME:-ignota}: il pacchetto è costruito su Ubuntu 24.04. glibc è compatibile solo all'indietro, quindi su una versione più VECCHIA il modulo nativo può non caricarsi."
  fi
fi

for c in curl tar sqlite3 systemctl; do
  if command -v "$c" >/dev/null 2>&1; then
    ok "$c presente"
  else
    ko "$c mancante — serve: apt-get install -y $c"
  fi
done

# Trappola 1 del documento: /usr/bin/node, non uno snap o un nvm.
if [[ -x "$NODE_BIN" ]]; then
  ok "$NODE_BIN presente (v$("$NODE_BIN" -p 'process.versions.node'), ABI $("$NODE_BIN" -p 'process.versions.modules'))"
  RESOLVED="$(command -v node 2>/dev/null || true)"
  if [[ -n "$RESOLVED" && "$RESOLVED" != "$NODE_BIN" ]]; then
    nb "nel PATH 'node' è $RESOLVED, non $NODE_BIN. Lo script di aggiornamento usa sempre $NODE_BIN (come ExecStart), quindi va bene, ma i comandi a mano del runbook no: usa il percorso assoluto."
  fi
else
  ko "$NODE_BIN non trovato. ExecStart lo cabla: uno snap o un nvm NON bastano (RUNBOOK-BACKEND.md, «Prima installazione», passo 2)."
fi

# ------------------------------------------------------------ 1. systemd ----

titolo '1. systemd attivo (in WSL non lo è per default)'

if [[ "$(ps -p 1 -o comm= 2>/dev/null || true)" == systemd ]]; then
  ok 'systemd è PID 1'
  STATO="$(systemctl is-system-running 2>/dev/null || true)"
  case "$STATO" in
    running | starting) ok "systemctl is-system-running: $STATO" ;;
    degraded)
      nb "systemctl is-system-running: degraded. Unità fallite:"
      systemctl list-units --failed --no-legend --no-pager 2>/dev/null | sed 's/^/          /' || true
      nb 'in WSL è comune e spesso innocuo, ma leggi la lista: se comparisse runwaysurfer, non è innocuo.'
      ;;
    *) nb "systemctl is-system-running: ${STATO:-nessuna risposta}" ;;
  esac
else
  ko "systemd NON è PID 1 (è '$(ps -p 1 -o comm= 2>/dev/null || echo ignoto)')."
  if [[ $IS_WSL -eq 1 ]]; then
    ko "in WSL va acceso a mano: metti [boot]\\nsystemd=true in /etc/wsl.conf, poi 'wsl --shutdown' da Windows e riapri. Senza, lo script di aggiornamento dice «la unit systemd non è installata», che è fuorviante."
  fi
fi

# ------------------------------------------- 2. direttive di sandboxing ----

titolo '2. Direttive di sandboxing della unit (il falso crash-loop)'

# ProtectSystem=strict & co. hanno bisogno di mount namespace e cgroup2. Sotto
# WSL possono dare status=226/NAMESPACE, che nel journal è INDISTINGUIBILE da un
# crash dell'applicazione: falserebbe sia Pass 1 sia S3 (rollback automatico).
if command -v systemd-run >/dev/null 2>&1 && [[ "$(ps -p 1 -o comm= 2>/dev/null || true)" == systemd ]]; then
  if systemd-run --quiet --wait --collect \
    -p ProtectSystem=strict -p ProtectHome=yes -p PrivateTmp=yes \
    -p PrivateDevices=yes -p ProtectKernelTunables=yes -p ProtectControlGroups=yes \
    /bin/true >/dev/null 2>&1; then
    ok 'le sei direttive di hardening funzionano su questo kernel'
  else
    ko 'una delle direttive di hardening fallisce (probabile status=226/NAMESPACE). ATTENZIONE: nel journal è identico a un crash dell applicazione, quindi Pass 1 fallirebbe e S3 «passerebbe» senza aver provato niente. Trova quale con: systemd-run --wait -p <una-alla-volta> /bin/true'
  fi
else
  nb 'systemd-run non disponibile: controllo saltato'
fi

# --------------------------------------------------- 3. network-online ----

titolo '3. network-online.target (il rollback spurio da timeout)'

# La unit lo mette in After=/Wants=, ma WSL non ha un wait-online. La unit non
# fissa TimeoutStartSec, quindi vale il default di systemd (90s), che è PIÙ del
# HEALTH_TIMEOUT di 60s dello script: il restart può ancora essere in coda
# quando lo script ha già deciso che il servizio non risponde.
NOL="$(systemctl is-active network-online.target 2>/dev/null || true)"
if [[ "$NOL" == active ]]; then
  ok 'network-online.target è active'
else
  nb "network-online.target è '${NOL:-assente}'. In WSL è normale (manca un wait-online), ma se un aggiornamento fallisse per timeout senza che il servizio sia davvero rotto, è il primo sospettato: il default TimeoutStartSec di systemd è 90s, HEALTH_TIMEOUT dello script è 60s."
fi

DEFT="$(systemctl show -p DefaultTimeoutStartUSec --value 2>/dev/null || true)"
[[ -n "$DEFT" ]] && nb "DefaultTimeoutStartUSec = $DEFT (HEALTH_TIMEOUT dello script: 60s)"

# ------------------------------------------------------- 4. porta 8787 ----

titolo '4. Porta di mock 8787 libera (la collisione con Windows)'

# Con la rete WSL2 in modalità mirrored, 127.0.0.1:8787 può raggiungere un
# `npm run dev` in esecuzione SU WINDOWS, che risponde commit:"dev". Lo script
# lo legge come «risponde ma con il commit sbagliato» e fa rollback.
SERVIZIO_ATTIVO="$(systemctl is-active "$UNIT" 2>/dev/null || true)"
RISPOSTA="$(curl -s --max-time 3 "http://127.0.0.1:$PORT_MOCK/health" 2>/dev/null || true)"
if [[ -z "$RISPOSTA" ]]; then
  ok "nessuno risponde su 127.0.0.1:$PORT_MOCK"
elif [[ "$SERVIZIO_ATTIVO" == active ]]; then
  ok "risponde su :$PORT_MOCK, ed è il nostro servizio (systemd lo dà active)"
else
  ko "qualcuno risponde su 127.0.0.1:$PORT_MOCK ma il servizio NON è attivo: quasi certamente un 'npm run dev' sul lato Windows raggiunto dalla rete mirrored. Risponde: ${RISPOSTA:0:120}. Lo script lo leggerebbe come «commit sbagliato» e farebbe un rollback che non serve. Chiudilo prima di iniziare."
fi

# ------------------------------------------------------- 5. CRLF in env ----

titolo '5. Fine riga nel file di configurazione'

# Lo script pulisce i \r quando legge (env_value), ma EnvironmentFile= di
# systemd NO: il servizio riceverebbe AI_PROVIDER=mock\r e abortirebbe con
# [config], mentre tutti i controlli dello script passano. Asimmetria cattiva.
if [[ -f "$ENVFILE" ]]; then
  if grep -qU $'\r' "$ENVFILE" 2>/dev/null; then
    ko "$ENVFILE contiene CRLF (creato da Windows?). Lo script li tollera, EnvironmentFile= di systemd NO: il servizio riceverebbe 'mock\\r' e morirebbe con [config], mentre i controlli passano. Correggi: sed -i 's/\\r\$//' $ENVFILE"
  else
    ok "$ENVFILE è LF"
  fi
  if grep -qE '^[[:space:]]*[A-Z_]+[[:space:]]*=[[:space:]]*$' "$ENVFILE"; then
    ko "$ENVFILE contiene righe 'VAR=' vuote: è la causa di un bug già corretto una volta, di perdita silenziosa del database. Cancella la riga invece di lasciarla vuota."
  else
    ok 'nessuna riga VAR= vuota'
  fi
else
  nb "$ENVFILE non esiste ancora (normale prima del passo 6 del runbook)"
fi

# ------------------------------------------------------ 6. filesystem ----

titolo '6. Filesystem di /opt (mai su /mnt/c)'

# Su DrvFs/9p i symlink e i permessi non si comportano come servono a
# swap_link() e a StateDirectory=.
PADRE="$ROOT"
while [[ ! -e "$PADRE" && "$PADRE" != / ]]; do PADRE="$(dirname "$PADRE")"; done
FSTIPO="$(stat -f -c %T "$PADRE" 2>/dev/null || echo ignoto)"
case "$FSTIPO" in
  ext2/ext3 | ext4 | xfs | btrfs) ok "$PADRE è su $FSTIPO" ;;
  v9fs | 9p | drvfs | cifs)
    ko "$PADRE è su $FSTIPO (un disco Windows montato). Symlink e permessi non funzionano come servono: /opt/runwaysurfer deve stare sul filesystem Linux."
    ;;
  *) nb "$PADRE è su $FSTIPO — verifica che non sia un disco Windows montato" ;;
esac

# ------------------------------------------------------------ riepilogo ----

titolo 'Riepilogo'
printf '  blocchi: %d    note: %d\n\n' "$FAIL" "$WARN"
if [[ $FAIL -gt 0 ]]; then
  printf '\033[31mNON procedere con Pass 1.\033[0m Ogni blocco qui sopra produrrebbe un esito\n'
  printf 'che sembra un difetto del prodotto e non lo è.\n'
  exit 1
fi
printf '\033[32mPass 0 superato.\033[0m Le note non fermano il collaudo, ma rileggile se un\n'
printf 'esito ti sembra assurdo.\n'
