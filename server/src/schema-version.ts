/**
 * Versione di schema che questa build conosce: il punto in cui si ferma la scala
 * di migrazioni in db.ts.
 *
 * File a sé, e SENZA import di proposito. `db.ts` apre la connessione SQLite al
 * momento dell'import, quindi chiunque voglia solo il NUMERO — la CI che lo
 * stampa nel pacchetto, `release.ts`, i test di migrazione — non deve pagare
 * quel prezzo né aprire un database per leggere una costante.
 *
 * QUANDO SI AGGIUNGE UNA MIGRAZIONE si tocca questa riga, e nient'altro: la
 * guardia anti-downgrade, il pacchetto e i test la leggono tutti da qui.
 */
export const SCHEMA_VERSION = 5;
