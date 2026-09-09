# Certificati di test per `tests/tls.test.ts`

**Queste chiavi NON sono un segreto.** Sono state generate per il repository, non
sono usate da nessun servizio, non sono firmate da nessuna CA e non valgono per
nessun hostname reale. Il prefisso `test-only.` serve esattamente a questo: se un
secret scanner le segnala, il triage è immediato. Non sostituirle con materiale
di produzione per nessun motivo.

## Perché sono file committati e non generati al volo

Node **non può** generare un certificato self-signed: `crypto.generateKeyPairSync`
produce solo chiavi e `crypto.X509Certificate` sa solo leggere — non esiste API di
firma né di CSR. L'alternativa era invocare `openssl` da `child_process` e
skippare i test dove manca: avrebbe disattivato in silenzio proprio i test sulle
macchine Windows, dove è più probabile che si rompa la gestione dei percorsi.

`notAfter` è nel 2100 così la CI non si rompe da sola col passare del tempo. Le
tre soglie di `assessCertificate` (`ok` / `expiring` / `expired`) si ottengono da
questa stessa coppia iniettando `now`, quindi non serve una fixture scaduta.

## Coppie presenti

| File | Uso |
|---|---|
| `test-only.crt` / `test-only.key` | Coppia principale. CN=`localhost`, SAN `DNS:localhost` + `IP:127.0.0.1`, EC P-256. |
| `test-only-renewed.crt` / `test-only-renewed.key` | Seconda coppia, CN=`localhost-renewed`, per simulare un rinnovo nei test del reloader. Serve anche a comporre una coppia NON abbinata (`test-only.crt` + `test-only-renewed.key`), che è il difetto reale quando un rinnovo scrive il certificato prima della chiave. |

## Comando usato

```sh
openssl req -x509 -newkey ec -pkeyopt ec_paramgen_curve:prime256v1 -nodes \
  -keyout test-only.key -out test-only.crt -days 27000 \
  -subj "/CN=localhost" \
  -addext "subjectAltName=DNS:localhost,IP:127.0.0.1"
```

Su Git Bash per Windows va anteposto `MSYS_NO_PATHCONV=1`, altrimenti `/CN=...`
viene riscritto come percorso.
