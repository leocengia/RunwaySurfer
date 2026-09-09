// Aggiornamento di un database che ESISTE GIÀ.
//
// PERCHÉ QUESTO FILE ESISTE: il resto della suite parte da un DB vuoto
// (tests/setup.ts crea un file temporaneo per worker), quindi esercita solo il
// percorso "CREATE TABLE con tutte le colonne". Il percorso vero di un
// aggiornamento — tabelle già presenti, colonne mancanti, migrate() che le
// aggiunge — non era coperto da nulla.
//
// Il guasto che ha motivato il file: una `CREATE INDEX` su `cited_sources` era
// stata messa nel blocco di initDb, che gira PRIMA di migrate(). Su un DB fresco
// funzionava (la CREATE TABLE include la colonna); sul database di sviluppo
// esistente il boot moriva con `SqliteError: no such column: cited_sources`.
// Tutti i 166 test passavano.
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import { describe, expect, it } from 'vitest';

// Il path va impostato PRIMA di importare db.ts, che apre la connessione al
// momento dell'import. Sovrascrive quello di setup.ts solo per questo file:
// vitest isola il registro dei moduli per file.
const dbPath = join(mkdtempSync(join(tmpdir(), 'rs-migr-')), 'legacy.db');
process.env.RUNWAYSURFER_DB_PATH = dbPath;

/**
 * Ricostruisce lo schema come era alla versione 3: `requests` SENZA
 * `cited_sources`, e nessuna tabella `feedback`.
 */
function buildLegacyDatabase(): void {
  const legacy = new Database(dbPath);
  legacy.exec(`
    CREATE TABLE teams (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL UNIQUE,
      created_at TEXT NOT NULL
    );
    CREATE TABLE users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      external_id TEXT NOT NULL UNIQUE,
      email TEXT,
      name TEXT,
      role TEXT NOT NULL DEFAULT 'agent',
      status TEXT NOT NULL DEFAULT 'pending',
      team_id INTEGER REFERENCES teams(id) ON DELETE SET NULL,
      password_hash TEXT,
      must_change_password INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE sessions (
      token_hash TEXT PRIMARY KEY,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      kind TEXT NOT NULL CHECK (kind IN ('cookie', 'bearer')),
      created_at TEXT NOT NULL,
      expires_at TEXT NOT NULL,
      last_seen_at TEXT NOT NULL
    );
    CREATE TABLE requests (
      id TEXT PRIMARY KEY,
      created_at TEXT NOT NULL,
      user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
      agent_id TEXT NOT NULL,
      team_id INTEGER REFERENCES teams(id) ON DELETE SET NULL,
      query_hash TEXT NOT NULL,
      query_preview TEXT NOT NULL,
      provider TEXT NOT NULL,
      model TEXT NOT NULL,
      pages_count INTEGER NOT NULL,
      links_count INTEGER NOT NULL,
      estimated_input_tokens INTEGER NOT NULL,
      estimated_output_tokens INTEGER NOT NULL,
      estimated_cost_usd REAL NOT NULL,
      actual_input_tokens INTEGER,
      actual_output_tokens INTEGER,
      duration_ms INTEGER NOT NULL,
      status TEXT NOT NULL,
      error TEXT,
      selected_links_json TEXT NOT NULL,
      sources_json TEXT NOT NULL,
      kind TEXT NOT NULL DEFAULT 'ask'
    );
    CREATE TABLE settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
  `);
  // Un utente e una richiesta preesistenti: l'aggiornamento non deve perderli.
  legacy
    .prepare(
      `INSERT INTO users (external_id, role, status, created_at, updated_at)
       VALUES ('vecchio@test', 'agent', 'active', '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z')`,
    )
    .run();
  legacy
    .prepare(
      `INSERT INTO requests (
        id, created_at, agent_id, query_hash, query_preview, provider, model,
        pages_count, links_count, estimated_input_tokens, estimated_output_tokens,
        estimated_cost_usd, duration_ms, status, selected_links_json, sources_json
      ) VALUES ('req-storica', '2026-01-01T00:00:00.000Z', 'vecchio@test', 'hash', 'domanda',
        'mock', 'claude-haiku-4-5', 1, 0, 10, 5, 0.001, 12, 'ok', '[]', '[]')`,
    )
    .run();
  legacy.pragma('user_version = 3');
  legacy.close();
}

/**
 * La versione di schema che `migrate()` deve raggiungere arriva dal CODICE
 * (`src/schema-version.ts`), non da una copia qui: così il test non può
 * "confermare" un numero sbagliato, e aggiungere una migrazione resta una riga
 * sola da toccare — quella. La stessa costante regge la guardia anti-downgrade e
 * il campo `schemaVersion` del pacchetto di release.
 */
import { SCHEMA_VERSION } from '../src/schema-version.js';

buildLegacyDatabase();
const { db, initDb, listFlaggedRequests, listUsers } = await import('../src/db.js');

describe('aggiornamento di un database esistente (v3 → v5)', () => {
  it('non lancia al boot', () => {
    // È letteralmente il guasto osservato: initDb() moriva con
    // "no such column: cited_sources" prima di arrivare a migrate().
    expect(() => initDb()).not.toThrow();
  });

  it('porta user_version all’ultima versione', () => {
    initDb();
    expect(db.pragma('user_version', { simple: true })).toBe(SCHEMA_VERSION);
  });

  it('aggiunge la colonna cited_sources e il suo indice', () => {
    initDb();
    const columns = (db.pragma('table_info(requests)') as Array<{ name: string }>).map(
      (c) => c.name,
    );
    expect(columns).toContain('cited_sources');
    const indexes = db
      .prepare("SELECT name FROM sqlite_master WHERE type = 'index' AND tbl_name = 'requests'")
      .all() as Array<{ name: string }>;
    expect(indexes.map((i) => i.name)).toContain('idx_requests_cited_sources');
  });

  it('crea la tabella feedback che non esisteva', () => {
    initDb();
    const tables = (
      db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all() as Array<{
        name: string;
      }>
    ).map((t) => t.name);
    expect(tables).toContain('feedback');
  });

  it('NON perde i dati preesistenti', () => {
    initDb();
    expect(listUsers().some((u) => u.external_id === 'vecchio@test')).toBe(true);
    const row = db.prepare('SELECT * FROM requests WHERE id = ?').get('req-storica') as {
      cited_sources: number | null;
      status: string;
    };
    expect(row.status).toBe('ok');
    // Nessun backfill: per una richiesta archiviata non sappiamo quante fonti
    // fossero citate, e NULL dice esattamente questo.
    expect(row.cited_sources).toBeNull();
  });

  it('la richiesta storica NON diventa una segnalazione', () => {
    // Il flag "senza fonti" guarda `= 0`, non `IS NULL`: altrimenti tutto lo
    // storico comparirebbe come problema il giorno dell'aggiornamento.
    initDb();
    expect(listFlaggedRequests({ limit: 100 }).some((r) => r.id === 'req-storica')).toBe(false);
  });

  it('aggiunge la colonna truncated (migrazione 5)', () => {
    initDb();
    const columns = (db.pragma('table_info(requests)') as Array<{ name: string }>).map(
      (c) => c.name,
    );
    expect(columns).toContain('truncated');
    // Nessun backfill: di una richiesta archiviata non sappiamo se fosse tagliata.
    const row = db.prepare('SELECT truncated FROM requests WHERE id = ?').get('req-storica') as {
      truncated: number | null;
    };
    expect(row.truncated).toBeNull();
  });

  it('è idempotente: un secondo avvio non cambia nulla', () => {
    initDb();
    initDb();
    expect(db.pragma('user_version', { simple: true })).toBe(SCHEMA_VERSION);
  });
});
