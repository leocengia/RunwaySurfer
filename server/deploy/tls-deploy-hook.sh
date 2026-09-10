#!/bin/sh
# Deploy hook per certbot: copia il materiale TLS rinnovato dove l'utente del
# servizio può leggerlo, e chiede la ricarica immediata.
#
# Installazione:
#   sudo install -m 0755 tls-deploy-hook.sh \
#        /etc/letsencrypt/renewal-hooks/deploy/10-runwaysurfer.sh
#
# Verifica (IMPORTANTE): un `certbot renew --dry-run` semplice NON esegue i
# deploy hook. Senza il flag qui sotto si testa "con successo" un rinnovo il cui
# hook non è mai partito, e lo si scopre 60 giorni dopo, a servizio fermo.
#   sudo certbot renew --dry-run --run-deploy-hooks
#
# Perché una copia e non puntare l'applicativo a /etc/letsencrypt/live/...:
#   - certbot crea live/ e archive/ come 0700 root:root e privkey.pem come
#     0600 root:root. L'utente del servizio non può nemmeno attraversare quelle
#     cartelle, e un chmod verrebbe ripristinato dal rinnovo successivo.
#   - /etc/runwaysurfer/tls/ NON contiene l'hostname nel percorso, così
#     l'hostname resta in tre soli posti — la renewal config di certbot, la GPO
#     delle postazioni e il DNS — e nessuno di questi è codice o .env.
#   - Stessa forma su Windows (C:\ProgramData\runwaysurfer\tls\), quindi il .env
#     cambia solo nel prefisso.
set -eu

DEST=/etc/runwaysurfer/tls
SERVICE=runwaysurfer
LINEAGE_NAME=runway-surfer.aviationsrl.it

# La cartella dei deploy hook viene eseguita per OGNI certificato della
# macchina: senza questo filtro un secondo servizio sullo stesso host
# sovrascriverebbe i nostri file con i suoi.
case "${RENEWED_LINEAGE:-}" in
  */"$LINEAGE_NAME") ;;
  *) exit 0 ;;
esac

install -d -m 0750 -o root -g "$SERVICE" "$DEST"

# Scrittura su .new e poi rename: l'applicativo rilegge i file a intervalli e su
# SIGHUP, e non deve mai poter leggere una chiave scritta a metà. `install`
# dereferenzia i symlink di live/ e imposta modo e proprietario in un passo solo.
install -m 0644 -o root -g "$SERVICE" "$RENEWED_LINEAGE/fullchain.pem" "$DEST/fullchain.pem.new"
install -m 0640 -o root -g "$SERVICE" "$RENEWED_LINEAGE/privkey.pem" "$DEST/privkey.pem.new"
mv -f "$DEST/fullchain.pem.new" "$DEST/fullchain.pem"
mv -f "$DEST/privkey.pem.new" "$DEST/privkey.pem"

# Ricarica immediata. Se il servizio è fermo o il segnale non arriva non è un
# errore fatale: l'applicativo rilegge i file da solo entro TLS_RELOAD_POLL_MS
# (default 6h), che è il motivo per cui un hook fallito non diventa un
# disservizio alla scadenza.
if ! systemctl kill -s HUP "$SERVICE" 2>/dev/null; then
  echo "[deploy-hook] SIGHUP a $SERVICE non consegnato: la ricarica avverrà al prossimo poll" >&2
fi

echo "[deploy-hook] materiale TLS aggiornato per ${RENEWED_DOMAINS:-$LINEAGE_NAME}" >&2
