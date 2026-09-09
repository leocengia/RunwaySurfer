// Carica `server/.env` in sviluppo, se esiste.
//
// PERCHÉ ESISTE QUESTO FILE: `.env.example` si legge come un file applicativo e
// il runbook diceva «in server/.env», ma niente lo leggeva davvero — non c'è
// dotenv e non c'era `--env-file`. Chi creava `server/.env` e lanciava
// `npm run dev` non vedeva NESSUN effetto e NESSUN errore, che è il modo
// peggiore in cui una configurazione può non funzionare.
//
// Va importato per PRIMO in index.ts: `config.ts` e `db.ts` leggono l'ambiente
// al momento dell'import, e in ESM le dipendenze si valutano nell'ordine in cui
// sono importate.
//
// `process.loadEnvFile` NON sovrascrive le variabili già presenti
// nell'ambiente. È la semantica che serve: in produzione l'EnvironmentFile di
// systemd resta l'autorità, e in sviluppo un `VAR=x npm run dev` inline vince
// sul file. In produzione, comunque, un `.env` accanto a dist/ non esiste.
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const envPath = join(dirname(fileURLToPath(import.meta.url)), '..', '.env');

// Aggiunta in Node 20.12: la guardia serve perché engines dichiara >=20.
if (typeof process.loadEnvFile === 'function' && existsSync(envPath)) {
  try {
    process.loadEnvFile(envPath);
    // Stampato prima di qualunque altra riga di avvio: se qualcosa nel .env è
    // sbagliato, si deve sapere che quel file è stato letto.
    console.log(`[config] caricato ${envPath}`);
  } catch (e) {
    console.warn(`[config] ${envPath} presente ma non caricabile:`, e);
  }
}
