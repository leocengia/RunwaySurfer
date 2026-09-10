#!/usr/bin/env bash
#
# Riporta la macchina di collaudo allo stato «prima della prima installazione».
# Serve a S5, che deve partire da un ambiente pulito, e a ricominciare da capo
# quando una serie di scenari ha lasciato uno stato confuso.
#
# CANCELLA /opt/runwaysurfer (release, backup, log degli aggiornamenti) e il
# database. Non tocca la unit systemd, l'utente di servizio, né il file di
# configurazione in /etc/runwaysurfer: quelli sono Pass 1 e rifarli non aggiunge
# niente al collaudo.
#
# Uso:  sudo deploy/collaudo/azzera.sh [--forza] [--tieni-database]
#
set -euo pipefail

ROOT=/opt/runwaysurfer
DB_DIR=/var/lib/runwaysurfer
UNIT=runwaysurfer

FORZA=0
TIENI_DB=0
while [[ $# -gt 0 ]]; do
  case "$1" in
    --forza) FORZA=1 ;;
    --tieni-database) TIENI_DB=1 ;;
    -h | --help)
      sed -n '2,15p' "$0" | sed 's/^# \{0,1\}//'
      exit 0
      ;;
    *)
      printf 'opzione non riconosciuta: %s\n' "$1" >&2
      exit 1
      ;;
  esac
  shift
done

[[ $EUID -eq 0 ]] || {
  printf 'va eseguito come root (usa sudo).\n' >&2
  exit 1
}

printf '\033[1mAzzeramento dell ambiente di collaudo\033[0m\n'
printf '  verrà cancellato: %s\n' "$ROOT"
if [[ $TIENI_DB -eq 0 ]]; then
  printf '  verrà cancellato: %s (database, WAL e shm)\n' "$DB_DIR"
else
  printf '  il database in %s viene TENUTO\n' "$DB_DIR"
fi
printf '  NON verranno toccati: la unit systemd, l utente di servizio, /etc/runwaysurfer\n'

if [[ -d "$ROOT/releases" ]]; then
  printf '  release attualmente presenti: %s\n' "$(ls -1 "$ROOT/releases" 2>/dev/null | tr '\n' ' ')"
fi

if [[ $FORZA -eq 0 ]]; then
  read -r -p $'\n  Scrivi AZZERA per confermare: ' risposta
  [[ "$risposta" == AZZERA ]] || {
    printf '  annullato.\n'
    exit 0
  }
fi

printf '\n'
# `disable` e non solo `stop`: S5 prova proprio la sequenza enable --now su un
# ambiente vuoto, e partire da «già abilitato» non proverebbe la stessa cosa.
systemctl stop "$UNIT" 2>/dev/null || true
systemctl disable "$UNIT" 2>/dev/null || true
# Il contatore di avvii falliti sopravvive a stop e disable: senza azzerarlo, il
# prossimo `restart` può beccarsi «Start request repeated too quickly» e
# attribuiremmo al prodotto un blocco che è avanzato dal test precedente.
systemctl reset-failed "$UNIT" 2>/dev/null || true
printf '  servizio fermato, disabilitato, contatore azzerato\n'

rm -rf "${ROOT:?}"
printf '  rimosso %s\n' "$ROOT"

if [[ $TIENI_DB -eq 0 ]]; then
  rm -f "${DB_DIR:?}/runwaysurfer.db" "${DB_DIR:?}/runwaysurfer.db-wal" "${DB_DIR:?}/runwaysurfer.db-shm"
  printf '  rimosso il database\n'
fi

printf '\n\033[32mAmbiente azzerato.\033[0m Da qui: passo 8 del RUNBOOK (prima installazione del codice).\n'
