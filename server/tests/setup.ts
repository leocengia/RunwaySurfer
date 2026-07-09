// Setup dei test backend: punta il DB a un file temporaneo unico per worker
// PRIMA che qualunque modulo importi db.ts (che apre la connessione all'import).
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

process.env.RUNWAYSURFER_DB_PATH = join(mkdtempSync(join(tmpdir(), 'rs-test-')), 'test.db');
