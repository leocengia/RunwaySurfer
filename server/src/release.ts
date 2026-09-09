// Identità della build in esecuzione.
//
// Serve a rispondere a una domanda che prima non aveva risposta: «quale versione
// sta girando adesso?». Senza, dopo un aggiornamento non c'è modo di distinguere
// «il pacchetto nuovo è attivo» da «il servizio è ripartito con il vecchio», e
// tutta la procedura di aggiornamento diventa non verificabile.
//
// PERCHÉ UN FILE LETTO A RUNTIME E NON UN `import`: RELEASE.json lo scrive la CI
// e NON esiste nel repository. Un import lo renderebbe una dipendenza di
// compilazione (`tsc` fallirebbe su un portatile appena clonato) e in ESM
// richiederebbe anche `with { type: 'json' }`. Un readFileSync in try/catch
// invece degrada da sé: da sorgente si ottiene 'dev' e non serve alcun passo di
// build.
//
// Il percorso funziona in ENTRAMBI i modi di avvio, per costruzione:
//   produzione   <release>/dist/release.js → ../RELEASE.json → <release>/RELEASE.json ✓
//   sviluppo     server/src/release.ts     → ../RELEASE.json → server/RELEASE.json (assente → 'dev')
//
// In produzione Node fa il realpath del main module ESM, quindi questo è il
// percorso della release REALE e non del symlink `server`: la versione riportata
// è quella del codice caricato, anche se il symlink è già stato spostato.
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { SCHEMA_VERSION } from './schema-version.js';

export interface ReleaseInfo {
  /** Versione da package.json, oppure 'dev' girando da sorgente. */
  version: string;
  commit: string;
  shortCommit: string;
  /** Identificativo della release: <data>.<numero run CI>.<sha corto>. */
  id: string;
  builtAt: string | null;
  /** Versione di schema che questa build CONOSCE (dal codice, non dal file). */
  schemaVersion: number;
  nodeVersion: string;
  /** Momento di avvio del processo: distingue un riavvio da un aggiornamento. */
  startedAt: string;
}

function read(): ReleaseInfo {
  const path = join(dirname(fileURLToPath(import.meta.url)), '..', 'RELEASE.json');
  const dev: ReleaseInfo = {
    version: 'dev',
    commit: 'dev',
    shortCommit: 'dev',
    id: 'dev',
    builtAt: null,
    schemaVersion: SCHEMA_VERSION,
    nodeVersion: process.version,
    startedAt: new Date().toISOString(),
  };
  try {
    const parsed = JSON.parse(readFileSync(path, 'utf8')) as Partial<ReleaseInfo>;
    return {
      ...dev,
      ...parsed,
      // Riletti dal processo e NON dal file: ciò che conta a runtime è quale
      // schema conosce questo codice e su quale Node sta girando davvero. Un
      // RELEASE.json copiato a mano non deve poter mentire su queste due.
      schemaVersion: SCHEMA_VERSION,
      nodeVersion: process.version,
      startedAt: dev.startedAt,
    };
  } catch {
    // Nessun RELEASE.json: si sta girando da sorgente. Non è un errore.
    return dev;
  }
}

export const RELEASE: ReleaseInfo = read();
