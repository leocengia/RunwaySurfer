// Typed messages exchanged over the runtime between the sidebar (content
// script context) and the background service worker.
import { browser } from 'wxt/browser';
import type { AskRequest, AskEvent } from './outcome';

/** Sidebar → background: run a query against the backend. */
export interface AskMessage {
  type: 'ask';
  request: AskRequest;
  /** Correlates the streamed responses below with this request. */
  requestId: string;
}

/** Background → sidebar: one streamed event for a given request. */
export interface AskStreamMessage {
  type: 'ask:event';
  requestId: string;
  event: AskEvent;
}

export type RuntimeMessage = AskMessage | AskStreamMessage;

/**
 * URL del backend usato se nessuno lo configura.
 *
 * Resta `localhost` di proposito finché non c'è l'hostname https di produzione:
 * è l'unico valore che funziona senza infrastruttura, e un default sbagliato che
 * "quasi" funziona è peggio di uno palesemente locale. Da sostituire con
 * l'hostname reale (vedi docs/INSTALLAZIONE-PILOTA.md).
 */
export const DEFAULT_PROXY_URL = 'http://localhost:8787';

/** Chiave usata sia in storage.managed (policy) sia in storage.local (manuale). */
export const PROXY_URL_KEY = 'proxyUrl';

function validUrl(value: unknown): string | null {
  if (typeof value !== 'string' || !value.trim()) return null;
  try {
    const url = new URL(value.trim());
    // Solo http/https: un valore incollato male non deve diventare una fetch
    // verso uno schema inatteso.
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
    return url.origin + url.pathname.replace(/\/+$/, '');
  } catch {
    return null;
  }
}

/**
 * Risolve l'URL del backend, in ordine di precedenza:
 *
 *  1. `storage.managed` — impostato dal CED via policy aziendale. Vince sempre:
 *     durante un rollout la configurazione centrale non deve poter essere
 *     scavalcata da un valore rimasto sulla postazione.
 *  2. `storage.local` — impostato a mano dalla pagina di configurazione.
 *  3. il default qui sopra.
 *
 * `storage.managed` è in sola lettura e su un profilo senza policy non esiste
 * affatto: l'accesso va protetto, non è un errore che manchi.
 */
export async function getProxyUrl(): Promise<string> {
  try {
    const managed = await browser.storage.managed?.get(PROXY_URL_KEY);
    const fromPolicy = validUrl(managed?.[PROXY_URL_KEY]);
    if (fromPolicy) return fromPolicy;
  } catch {
    /* nessuna policy su questo profilo: si prosegue */
  }
  try {
    const local = await browser.storage.local.get(PROXY_URL_KEY);
    return validUrl(local[PROXY_URL_KEY]) ?? DEFAULT_PROXY_URL;
  } catch {
    return DEFAULT_PROXY_URL;
  }
}

/** Salva l'URL scelto dalla pagina di configurazione. Ritorna il valore normalizzato. */
export async function setProxyUrl(value: string): Promise<string> {
  const normalized = validUrl(value);
  if (!normalized) throw new Error('URL non valido: usa http:// o https://');
  await browser.storage.local.set({ [PROXY_URL_KEY]: normalized });
  return normalized;
}
