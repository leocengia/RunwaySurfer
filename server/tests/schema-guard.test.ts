// Guardia anti-downgrade: un database scritto da una build PIÙ RECENTE non va
// toccato.
//
// Le migrazioni sono forward-only. Se `user_version` supera SCHEMA_VERSION, ogni
// `if (version < N)` in migrate() è falso, migrate() esce in silenzio e il
// servizio parte su uno schema che non conosce: sembra funzionare, e il danno si
// vede giorni dopo. Il caso concreto è un rollback a una release precedente
// dopo che quella nuova ha già migrato.
//
// Come migration.test.ts: il database va preparato PRIMA dell'import di db.ts,
// che apre la connessione al momento dell'import.
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import { describe, expect, it } from 'vitest';
// Import statico legittimo: schema-version.ts è senza effetti collaterali, non
// apre nessun database.
import { SCHEMA_VERSION } from '../src/schema-version.js';

const dbPath = join(mkdtempSync(join(tmpdir(), 'rs-future-')), 'future.db');
process.env.RUNWAYSURFER_DB_PATH = dbPath;

// Un database come lo avrebbe lasciato una build futura. Derivato da
// SCHEMA_VERSION + 1 così questo test non va più toccato quando si aggiunge una
// migrazione.
const future = new Database(dbPath);
future.pragma(`user_version = ${SCHEMA_VERSION + 1}`);
future.close();

const { initDb } = await import('../src/db.js');

describe('database scritto da una build più recente', () => {
  it('non parte, e il messaggio dice quale schema ha trovato', () => {
    expect(() => initDb()).toThrow(/schema/i);
    expect(() => initDb()).toThrow(new RegExp(String(SCHEMA_VERSION + 1)));
  });

  it('nomina il percorso del database, così si sa quale file guardare', () => {
    expect(() => initDb()).toThrow(/future\.db/);
  });

  it('non ha toccato il database', () => {
    // La verifica che conta: la guardia sta PRIMA delle CREATE TABLE, quindi un
    // database del futuro resta esattamente come era. Se una sola CREATE fosse
    // passata, un eventuale ripristino partirebbe da uno stato ibrido.
    const check = new Database(dbPath, { readonly: true });
    try {
      expect(check.pragma('user_version', { simple: true })).toBe(SCHEMA_VERSION + 1);
      const tables = check
        .prepare("SELECT count(*) AS n FROM sqlite_master WHERE type = 'table'")
        .get() as { n: number };
      expect(tables.n).toBe(0);
    } finally {
      check.close();
    }
  });
});
