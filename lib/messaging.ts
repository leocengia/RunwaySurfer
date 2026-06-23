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

/** Default backend URL; overridable via extension storage (settings). */
export const DEFAULT_PROXY_URL = 'http://localhost:8787';

export async function getProxyUrl(): Promise<string> {
  try {
    const { proxyUrl } = await browser.storage.local.get('proxyUrl');
    return typeof proxyUrl === 'string' && proxyUrl ? proxyUrl : DEFAULT_PROXY_URL;
  } catch {
    return DEFAULT_PROXY_URL;
  }
}
