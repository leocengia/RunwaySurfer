// Pagina di configurazione dell'estensione.
//
// Esiste per una ragione operativa: prima l'URL del backend si poteva impostare
// solo scrivendo in `storage.local` dalla console DevTools, su ogni postazione.
// Con 5-10 agenti da installare a mano quella non è una procedura.
import { browser } from 'wxt/browser';
import { DEFAULT_PROXY_URL, PROXY_URL_KEY, getProxyUrl, setProxyUrl } from '../../lib/messaging';
import { LOGO_MARK } from '../../shared/logo-mark';

const el = <T extends HTMLElement>(id: string): T => {
  const node = document.getElementById(id);
  if (!node) throw new Error(`elemento mancante: ${id}`);
  return node as T;
};

const input = el<HTMLInputElement>('proxy-url');
const feedback = el<HTMLParagraphElement>('feedback');
const managedNote = el<HTMLParagraphElement>('managed');
const saveBtn = el<HTMLButtonElement>('save');
const testBtn = el<HTMLButtonElement>('test');

el<HTMLImageElement>('mark').src = LOGO_MARK;

// Versione dell'estensione, leggibile senza DevTools: quando si chiede a un
// agente «che versione hai?», deve poterla leggere da qui e dirla al telefono.
// Non va nella sidebar, che resta libera da stringhe tecniche.
el<HTMLSpanElement>('ext-version').textContent = browser.runtime.getManifest().version;

type Tone = 'ok' | 'error' | 'busy' | 'none';

function say(message: string, tone: Tone = 'none'): void {
  feedback.textContent = message;
  feedback.dataset.tone = tone;
}

/** Se la policy aziendale impone l'URL, il campo diventa in sola lettura. */
async function readManagedUrl(): Promise<string | null> {
  try {
    const managed = await browser.storage.managed?.get(PROXY_URL_KEY);
    const value = managed?.[PROXY_URL_KEY];
    return typeof value === 'string' && value ? value : null;
  } catch {
    return null;
  }
}

async function init(): Promise<void> {
  input.value = await getProxyUrl();
  const managed = await readManagedUrl();
  if (managed) {
    input.value = managed;
    input.readOnly = true;
    saveBtn.disabled = true;
    managedNote.hidden = false;
  }
  if (input.value === DEFAULT_PROXY_URL) {
    say('Stai usando l’indirizzo locale predefinito: va bene solo in prova.', 'none');
  }
}

saveBtn.addEventListener('click', () => {
  void (async () => {
    try {
      const saved = await setProxyUrl(input.value);
      input.value = saved;
      say('Salvato. Ricarica la pagina della Knowledge Base per applicarlo.', 'ok');
    } catch (e) {
      say(e instanceof Error ? e.message : 'URL non valido.', 'error');
    }
  })();
});

testBtn.addEventListener('click', () => {
  void (async () => {
    const url = input.value.trim().replace(/\/+$/, '');
    if (!url) {
      say('Inserisci prima un indirizzo.', 'error');
      return;
    }
    testBtn.disabled = true;
    say('Contatto il servizio…', 'busy');
    // Scadenza esplicita: senza, un host raggiungibile ma appeso lascia il
    // pulsante a girare per sempre e nessuno sa se stia facendo qualcosa.
    const timeout = new AbortController();
    const timer = setTimeout(() => timeout.abort(), 8000);
    try {
      const res = await fetch(`${url}/health`, { signal: timeout.signal });
      if (!res.ok) {
        say(`Il servizio risponde ma con un errore (${res.status}). Segnalalo.`, 'error');
        return;
      }
      const body = (await res.json()) as {
        status?: string;
        provider?: string;
        version?: string;
        commit?: string;
      };
      // Versione e commit del BACKEND, non solo «risponde». Così un clic da una
      // postazione risponde a «stai parlando con la release che ho appena
      // installato?» senza DevTools e senza aprire un ticket.
      const build = body.version ? ` — servizio ${body.version} (${body.commit ?? '?'})` : '';
      say(
        `Connessione riuscita${build}${body.provider ? `, provider: ${body.provider}` : ''}. Puoi salvare.`,
        'ok',
      );
    } catch {
      say(
        url.startsWith('http://') && !url.includes('localhost')
          ? 'Nessuna risposta. Nota: un indirizzo http:// viene bloccato dal browser quando l’estensione lavora dentro la Knowledge Base — serve https://.'
          : 'Nessuna risposta dal servizio. Controlla l’indirizzo e di essere in rete (o in VPN).',
        'error',
      );
    } finally {
      clearTimeout(timer);
      testBtn.disabled = false;
    }
  })();
});

void init();
