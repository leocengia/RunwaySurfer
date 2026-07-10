// Manutenzione periodica del DB: applica la retention dello storico richieste
// (settings.retention_days, default 90) e rimuove le sessioni scadute.
// Prima di questo job la retention era solo documentata: pruneOldRequests()
// veniva invocata unicamente dall'endpoint manuale POST /maintenance/prune.
import { pruneOldRequests, deleteExpiredSessions } from './db.js';

const RUN_EVERY_MS = 24 * 60 * 60 * 1000; // una volta al giorno

function runMaintenance(): void {
  try {
    const prunedRequests = pruneOldRequests();
    const expiredSessions = deleteExpiredSessions();
    console.log(
      `[maintenance] retention applicata: ${prunedRequests} richieste oltre la retention eliminate, ` +
        `${expiredSessions} sessioni scadute rimosse`,
    );
  } catch (e) {
    console.error('[maintenance] job di retention fallito:', e);
  }
}

/** Esegue subito una passata e poi ogni 24h. unref(): non blocca lo shutdown. */
export function startMaintenanceScheduler(): void {
  runMaintenance();
  setInterval(runMaintenance, RUN_EVERY_MS).unref();
}
