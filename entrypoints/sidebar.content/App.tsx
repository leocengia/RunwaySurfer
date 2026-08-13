import {
  type PointerEvent as ReactPointerEvent,
  useCallback,
  useEffect,
  useRef,
  useState,
} from 'react';
import { browser } from 'wxt/browser';
import { detectUnreadablePage, extractCurrentPage, extractInternalLinks } from '../../lib/extract';
import {
  MAX_FOLLOW,
  pickCandidatesWithKbIndex,
  shallowFollow,
  shortlistCandidates,
  resolveFollowLinks,
} from '../../lib/crawl';
import { readIndexOnlyArticles } from '../../lib/nav';
import { isOffTopic } from '../../lib/off-topic';
import { linkIdentity } from '../../lib/site-profile';
import { streamAsk, rankCandidates, BACKEND_UNREACHABLE } from '../../lib/client';
import { redactionNotice, scrubPii } from '../../lib/scrub';
import { getProxyUrl } from '../../lib/messaging';
import { clearToken, fetchMe, getToken, logout, type AuthUser } from '../../lib/auth';
import type { AiPlan, AskTurn, KbLink, KbPage, ScheduleChangeRequest } from '../../lib/outcome';
import {
  clearTour,
  clearTourResult,
  loadTourResult,
  markTourAborted,
  normalizeUrl,
  startTour,
  type TourState,
} from '../../lib/tour';
import { setBannerOffset, teardownFx } from '../../lib/fx';
import { observeHostHeader } from '../../lib/host-chrome';
import { LoginForm, ChangePasswordForm } from './AuthForms';
import { Logo } from './Logo';
import { OutcomeView } from './OutcomeView';
import {
  emptyFormDraft,
  isFormComplete,
  ScheduleChangeForm,
  type FormDraft,
} from './ScheduleChangeForm';
import { ThreadView } from './ThreadView';
import { TourTimeline } from './TourTimeline';
import { useAutoGrow } from './useAutoGrow';
import { useTourDriver, type AskResult } from './useTourDriver';

type Status = 'idle' | 'reading' | 'streaming' | 'done' | 'error';
type Mode = 'single' | 'follow' | 'visual';
// 'offline' esiste perché "backend spento" e "sessione scaduta" sono problemi
// diversi con rimedi diversi: mandare al form di login chi non ha rete gli fa
// digitare le credenziali per poi vedere un errore di rete incomprensibile.
type AuthPhase = 'checking' | 'offline' | 'loggedOut' | 'mustChange' | 'in';

/** Le tre modalità come segmented control: l'etichetta breve sta nel bottone,
 *  la spiegazione completa nel title (in 320px non ci stanno entrambe).
 *  I valori interni restano quelli originali: sono la chiave su cui ramificano
 *  run(), il driver del tour e `supportedModes` lato server. */
const MODES: ReadonlyArray<{ value: Mode; label: string; hint: string }> = [
  { value: 'visual', label: 'Immersiva', hint: 'Tour visivo automatico sulle pagine collegate' },
  { value: 'follow', label: 'Background', hint: 'Legge le pagine collegate in background' },
  { value: 'single', label: 'Analisi Articolo', hint: 'Legge solo la pagina corrente' },
];

/** Override manuale dell'altezza banda, se l'euristica sbaglia sulla KB reale.
 *  Il default vive nel CSS (`var(--rs-host-header-h, 56px)`), non qui. */
const HOST_HEADER_OVERRIDE_KEY = 'rs:hostHeaderHeight';

/** Diagnostica estesa nel pannello risposta: per noi durante il pilota. */
const DEBUG_KEY = 'rs:debug';

const SIDEBAR_WIDTH_KEY = 'rs:sidebarWidth';
const DEFAULT_SIDEBAR_WIDTH = 360;
const MIN_SIDEBAR_WIDTH = 320;
const MIN_PAGE_WIDTH = 240;

function maxSidebarWidth(): number {
  return Math.max(MIN_SIDEBAR_WIDTH, window.innerWidth - MIN_PAGE_WIDTH);
}

/** Identità canonica (origin+path) di un URL, per deduplicare pagine e candidati. */
function identityOf(url: string): string {
  try {
    return linkIdentity(new URL(url, location.href));
  } catch {
    return url;
  }
}

function clampSidebarWidth(width: number): number {
  return Math.min(Math.max(width, MIN_SIDEBAR_WIDTH), maxSidebarWidth());
}

function statusLabel(status: Status, mode: Mode): string {
  if (status === 'reading') return mode === 'visual' ? 'Immersiva' : 'Lettura';
  if (status === 'streaming') return 'Generazione';
  if (status === 'error') return 'Errore';
  // A riposo (`idle`) e a risposta conclusa (`done`) il significato è lo stesso:
  // niente in corso, si può partire.
  return 'Ready';
}

/** X del pulsante di chiusura: SVG, non il carattere "x" del font. */
function CloseIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true">
      <path
        d="M1.5 1.5l9 9M10.5 1.5l-9 9"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
      />
    </svg>
  );
}

export default function App() {
  const [open, setOpen] = useState(true);
  const [authPhase, setAuthPhase] = useState<AuthPhase>('checking');
  /** Motivo per cui la sessione non è verificabile, mostrato nella fase offline. */
  const [authError, setAuthError] = useState('');
  const [me, setMe] = useState<AuthUser | null>(null);
  const [query, setQuery] = useState('');
  // Default single-page: sulla KB Salesforce (client-rendered) le altre modalità
  // non possono leggere altre pagine via fetch (vedi hasRenderedContent), e la
  // pagina corrente è la più economica in token.
  const [mode, setMode] = useState<Mode>('single');
  const [status, setStatus] = useState<Status>('idle');
  const [plan, setPlan] = useState<AiPlan | null>(null);
  const [outcome, setOutcome] = useState('');
  const [error, setError] = useState('');
  /** Avviso non bloccante: es. "la pagina aperta non copre la domanda". */
  const [notice, setNotice] = useState('');
  /**
   * Avviso di redazione, separato da `notice`: i due possono capitare nella
   * stessa ricerca (dato rimosso E ricerca allargata) e non devono sovrascriversi.
   */
  const [redaction, setRedaction] = useState('');
  const [pagesUsed, setPagesUsed] = useState<KbPage[]>([]);
  const [tour, setTour] = useState<TourState | null>(null);
  /** Turni conclusi della conversazione: restano a schermo e tornano al modello. */
  const [thread, setThread] = useState<AskTurn[]>([]);
  /** Il caso è uno Schedule Change: il prompt libero cede il posto al form. */
  const [structured, setStructured] = useState(false);
  const [formDraft, setFormDraft] = useState<FormDraft>(emptyFormDraft);
  /** Dettaglio live del passo di tour in corso, mostrato dalla timeline. */
  const [tourDetail, setTourDetail] = useState('');
  const [stopping, setStopping] = useState(false);
  const [sidebarWidth, setSidebarWidth] = useState(DEFAULT_SIDEBAR_WIDTH);
  /** Altezza della banda blu della KB, per allinearci a essa. 0 = non misurata. */
  const [hostHeaderHeight, setHostHeaderHeight] = useState(0);
  /**
   * Diagnostica estesa nel pannello della risposta (modello, token, costo,
   * egress). Si attiva mettendo `rs:debug` a true in storage.local: serve a noi
   * durante il pilota, non all'agente al telefono.
   */
  const [debug, setDebug] = useState(false);
  const queryRef = useRef<HTMLTextAreaElement | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  // `runAsk` è memoizzato su [] e viene passato a useTourDriver: leggere lo
  // storico da un ref evita che la sua identità cambi a ogni turno, cosa che
  // ricreerebbe il driver del tour a metà cammino.
  const threadRef = useRef<AskTurn[]>([]);
  const tourAbortRef = useRef(false);
  const drivingRef = useRef(false);
  // Live sidebar geometry for the tour banner (driveTour must not re-create
  // on every resize, so it reads these refs instead of closing over state).
  const openRef = useRef(open);
  const sidebarWidthRef = useRef(sidebarWidth);
  const originalBodyStylesRef = useRef<{ marginRight: string; transition: string } | null>(null);

  // Validate the stored token at mount: decides login form vs main UI.
  // Estratta da useEffect perché il pulsante "Riprova" della schermata offline
  // rifà esattamente questo controllo.
  const checkSession = useCallback(async (): Promise<void> => {
    setAuthPhase('checking');
    setAuthError('');
    const result = await fetchMe(await getProxyUrl());
    if (result.state === 'offline') {
      setMe(null);
      setAuthError(result.message);
      setAuthPhase('offline');
      return;
    }
    if (result.state === 'loggedOut') {
      setMe(null);
      setAuthPhase('loggedOut');
      return;
    }
    setMe(result.user);
    setAuthPhase(result.user.mustChangePassword ? 'mustChange' : 'in');
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const result = await fetchMe(await getProxyUrl());
      if (cancelled) return;
      if (result.state === 'offline') {
        setAuthError(result.message);
        setAuthPhase('offline');
        return;
      }
      const user = result.state === 'in' ? result.user : null;
      setMe(user);
      setAuthPhase(user ? (user.mustChangePassword ? 'mustChange' : 'in') : 'loggedOut');
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const onLoggedIn = useCallback((user: AuthUser) => {
    setMe(user);
    setAuthPhase(user.mustChangePassword ? 'mustChange' : 'in');
  }, []);

  const doLogout = useCallback(async () => {
    await logout(await getProxyUrl());
    setMe(null);
    setAuthPhase('loggedOut');
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const stored = await browser.storage.local.get(SIDEBAR_WIDTH_KEY);
        const width = stored[SIDEBAR_WIDTH_KEY];
        if (!cancelled && typeof width === 'number') {
          setSidebarWidth(clampSidebarWidth(width));
        }
      } catch {
        /* keep default */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const stored = await browser.storage.local.get(DEBUG_KEY);
        if (!cancelled) setDebug(stored[DEBUG_KEY] === true);
      } catch {
        /* niente diagnostica: è il default */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    openRef.current = open;
    sidebarWidthRef.current = sidebarWidth;
  }, [open, sidebarWidth]);

  useEffect(() => {
    threadRef.current = thread;
  }, [thread]);

  // Misura la banda blu della KB e la tiene aggiornata. L'header della sidebar e
  // la barra del tour si allineano a questo valore: senza, la sidebar è più bassa
  // della banda del sito e le tre superfici non sono incolonnate.
  useEffect(() => {
    let dispose = () => {};
    let cancelled = false;
    (async () => {
      let override: number | null = null;
      try {
        const stored = await browser.storage.local.get(HOST_HEADER_OVERRIDE_KEY);
        const value = stored[HOST_HEADER_OVERRIDE_KEY];
        if (typeof value === 'number' && value > 0) override = value;
      } catch {
        /* nessun override: si misura */
      }
      if (cancelled) return;
      dispose = observeHostHeader(setHostHeaderHeight, { override });
    })();
    return () => {
      cancelled = true;
      dispose();
    };
  }, []);

  // La barra del tour vive nella pagina host, fuori dallo shadow root: l'altezza
  // le arriva da una custom property su <html>.
  useEffect(() => {
    const root = document.documentElement;
    if (hostHeaderHeight > 0) root.style.setProperty('--rs-host-header-h', `${hostHeaderHeight}px`);
    else root.style.removeProperty('--rs-host-header-h');
  }, [hostHeaderHeight]);

  // La barra del tour vive nel DOM della pagina host e non conosce la geometria
  // della sidebar. Prima l'offset veniva calcolato solo al mount del banner, così
  // un resize o una chiusura a metà tour lo lasciavano disallineato per tutto il
  // passo. Qui lo teniamo aggiornato mentre il tour è vivo.
  useEffect(() => {
    if (!tour) return;
    setBannerOffset(open ? sidebarWidth : 0);
  }, [tour, open, sidebarWidth]);

  useEffect(() => {
    if (!open) return;
    browser.storage.local.set({ [SIDEBAR_WIDTH_KEY]: sidebarWidth }).catch(() => {
      /* best-effort */
    });
  }, [open, sidebarWidth]);

  useEffect(() => {
    if (!open) return;
    const onResize = () => setSidebarWidth((width) => clampSidebarWidth(width));
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, [open]);

  useEffect(() => {
    const body = document.body;
    if (!body) return;

    if (!open) {
      if (originalBodyStylesRef.current) {
        body.style.marginRight = originalBodyStylesRef.current.marginRight;
        body.style.transition = originalBodyStylesRef.current.transition;
        originalBodyStylesRef.current = null;
      }
      return;
    }

    if (!originalBodyStylesRef.current) {
      originalBodyStylesRef.current = {
        marginRight: body.style.marginRight,
        transition: body.style.transition,
      };
    }

    body.style.marginRight = `${sidebarWidth}px`;
    body.style.transition = body.style.transition || 'margin-right 120ms ease';

    return () => {
      if (originalBodyStylesRef.current) {
        body.style.marginRight = originalBodyStylesRef.current.marginRight;
        body.style.transition = originalBodyStylesRef.current.transition;
        originalBodyStylesRef.current = null;
      }
    };
  }, [open, sidebarWidth]);

  const resetSession = useCallback(async () => {
    abortRef.current?.abort();
    tourAbortRef.current = true;
    drivingRef.current = false;
    teardownFx();
    // Stamp the cross-navigation abort flag (like stopTour) so a tour whose
    // navigation is already committing does not resurrect on the next page.
    await markTourAborted();
    await clearTour();
    await clearTourResult();
    setQuery('');
    setPlan(null);
    setOutcome('');
    setError('');
    setNotice('');
    setRedaction('');
    setPagesUsed([]);
    setThread([]);
    threadRef.current = [];
    setFormDraft(emptyFormDraft());
    setTour(null);
    setTourDetail('');
    setStopping(false);
    setStatus('idle');
  }, []);

  // Stream the outcome for a collected set of pages (shared by all modes).
  const runAsk = useCallback(
    async (
      q: string,
      pages: KbPage[],
      linksOverride = extractInternalLinks(),
      form?: ScheduleChangeRequest,
    ): Promise<AskResult> => {
      abortRef.current?.abort();
      const controller = new AbortController();
      abortRef.current = controller;
      let accumulatedOutcome = '';
      let receivedPlan: AiPlan | null = null;

      setStatus('streaming');
      // Azzera SOLO il turno in corso: i turni conclusi vivono in `thread` e
      // restano a schermo, altrimenti un approfondimento cancellerebbe la
      // risposta che l'agente sta ancora leggendo.
      setOutcome('');
      setPlan(null);
      setError('');
      setPagesUsed(pages);

      const proxyUrl = await getProxyUrl();
      const token = await getToken();
      // Lo storico viaggia dal client: il backend resta stateless e la tabella di
      // audit è privacy-minimised, quindi non potrebbe ricostruirlo. Il tetto sui
      // turni lo applica il server (setting max_history_turns).
      let streamFailed = false;
      await streamAsk(
        proxyUrl,
        { query: q.trim(), pages, links: linksOverride, history: threadRef.current, form },
        (event) => {
          switch (event.type) {
            case 'plan':
              receivedPlan = event.plan;
              setPlan(event.plan);
              break;
            case 'delta':
              accumulatedOutcome += event.text;
              setOutcome((prev) => prev + event.text);
              // Segnale concreto durante la generazione: la risposta cresce.
              // Letto dalla timeline del tour, dove la barra è indeterminata.
              setTourDetail(`ricevuti ${accumulatedOutcome.length} caratteri...`);
              break;
            case 'done':
              setStatus('done');
              break;
            case 'error':
              streamFailed = true;
              setError(event.message);
              setStatus('error');
              break;
            case 'auth-required':
              // Session expired or revoked: back to the login form.
              streamFailed = true;
              void clearToken();
              setMe(null);
              setAuthPhase('loggedOut');
              setStatus('idle');
              break;
          }
        },
        controller.signal,
        token,
      );
      setStatus((s) => (s === 'streaming' ? 'done' : s));
      // Turno concluso: entra nello storico solo se ha prodotto una risposta e
      // non è stato interrotto, così un abort non inquina il contesto successivo.
      if (accumulatedOutcome.trim() && !controller.signal.aborted) {
        setThread((prev) => [...prev, { query: q.trim(), answer: accumulatedOutcome }]);
      }
      return { outcome: accumulatedOutcome, plan: receivedPlan, failed: streamFailed };
    },
    [],
  );

  // Tour visivo: la macchina a stati vive in useTourDriver.ts.
  const driveTour = useTourDriver({
    runAsk,
    openRef,
    sidebarWidthRef,
    tourAbortRef,
    drivingRef,
    setTour,
    setQuery,
    setPagesUsed,
    setStatus,
    setTourDetail,
  });

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const result = await loadTourResult();
      if (cancelled || !result) return;
      // Tolerant match: normalizeUrl only strips the hash, so a redirect that
      // adds/removes a trailing slash would drop the answer. Also accept a very
      // fresh result (the tour just navigated here) even if the landing URL
      // differs slightly, so the generated answer is never silently lost.
      const stripSlash = (u: string) => normalizeUrl(u).replace(/\/+$/, '');
      const urlMatches = stripSlash(result.targetUrl) === stripSlash(location.href);
      const fresh = Date.now() - result.startedAt < 15_000;
      if (!urlMatches && !fresh) return;
      setOpen(true);
      setMode('visual');
      setQuery(result.query);
      setOutcome(result.outcome);
      setPlan(result.plan);
      setPagesUsed(result.pages);
      setError('');
      setStatus('done');
      setTour(null);
      setTourDetail('');
      await clearTourResult();
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    // The in-page walk never crosses a reload, so there is no tour to resume on
    // mount. Just sweep any FX leftover from a previous content-script life
    // (e.g. an aborted tour) and drop any legacy persisted tour state.
    teardownFx();
    void clearTour();
  }, []);

  /**
   * Cerca in TUTTA la Knowledge Base e legge gli articoli scelti.
   *
   * Prefiltro locale sull'indice (2964 articoli, costo-token zero) → shortlist →
   * `/rank` che fa scegliere all'AI → lettura via fetch e, per gli articoli non
   * linkati in pagina, via iframe nascosto. Estratta perché serve a tre chiamanti:
   * la modalità Background, la richiesta strutturata e l'allargamento automatico
   * quando la pagina aperta non c'entra con la domanda.
   */
  const searchWholeKb = useCallback(
    async (
      searchQuery: string,
      links: KbLink[],
      alreadyRead: KbPage[],
    ): Promise<{ pages: KbPage[]; askLinks: KbLink[] }> => {
      const shortlist = shortlistCandidates(links, searchQuery);
      const rankCtrl = new AbortController();
      const rankTimer = setTimeout(() => rankCtrl.abort(), 5_000);
      let selectedUrls: string[] = [];
      try {
        const proxyUrl = await getProxyUrl();
        const token = await getToken();
        const sel = await rankCandidates(
          proxyUrl,
          { query: searchQuery, candidates: shortlist },
          rankCtrl.signal,
          token,
        );
        selectedUrls = sel?.selectedUrls ?? [];
      } finally {
        clearTimeout(rankTimer);
      }
      // Fallback su selezione locale se il rerank non dà nulla di usabile.
      const askLinks = resolveFollowLinks(
        shortlist,
        selectedUrls,
        pickCandidatesWithKbIndex(links, searchQuery),
      );

      const pages: KbPage[] = [];
      const followed = await shallowFollow(askLinks, searchQuery, askLinks.length);
      pages.push(...followed);
      // I candidati SOLO-INDICE (non presenti come anchor in pagina, quindi né
      // seguibili dal tour né leggibili via fetch sulla KB Aura) si aprono via
      // navigazione SPA in un iframe nascosto e si leggono dal DOM renderizzato.
      const pageIds = new Set(links.map((l) => identityOf(l.url)));
      const readIds = new Set([...alreadyRead, ...pages].map((p) => identityOf(p.url)));
      const indexOnly = askLinks.filter(
        (l) => !pageIds.has(identityOf(l.url)) && !readIds.has(identityOf(l.url)),
      );
      const spaBudget = MAX_FOLLOW - followed.length;
      if (spaBudget > 0 && indexOnly.length) {
        const controller = new AbortController();
        abortRef.current = controller;
        const viaSpa = await readIndexOnlyArticles(indexOnly, searchQuery, spaBudget, {
          shouldAbort: () => controller.signal.aborted,
        });
        pages.push(...viaSpa);
      }
      return { pages, askLinks };
    },
    [],
  );

  const run = useCallback(async () => {
    if (status === 'reading' || status === 'streaming') return;
    // Con il form compilato la prosa libera è opzionale: i campi SONO la domanda.
    const formReady = structured && isFormComplete(formDraft);
    if (!query.trim() && !formReady) return;
    setNotice('');

    // REDAZIONE, prima di qualunque uso. `safeQuery` sostituisce la query grezza
    // in TUTTO ciò che segue — ricerca in KB, estrazione della pagina, prompt,
    // storico del thread — così il dato del cliente non esiste già da qui in poi.
    // Il testo nella textarea resta quello scritto dall'agente: vede ciò che ha
    // digitato, ma non è quello che parte.
    const { text: safeQuery, redacted } = scrubPii(query.trim());
    setRedaction(redactionNotice(redacted));

    // Guardia sessione: se la pagina corrente è la login KB (SSO scaduto) niente
    // è leggibile, nemmeno gli altri articoli (serve la stessa sessione).
    const unreadable = detectUnreadablePage();
    if (unreadable === 'login') {
      setError(
        'Sembra la pagina di login della KB (sessione scaduta): apri un articolo da loggato e riprova.',
      );
      setStatus('error');
      return;
    }
    // "Non è un articolo leggibile" blocca solo chi ha bisogno di QUESTA pagina:
    // una richiesta strutturata cerca comunque in tutta la KB.
    if (unreadable && !formReady) {
      setError('Questa pagina non sembra un articolo leggibile (contenuto non trovato).');
      setStatus('error');
      return;
    }

    // Richiesta strutturata: la risposta sta negli articoli di policy del vettore,
    // quasi certamente NON in quello aperto. Si cerca in tutta la KB usando i
    // campi del form come quesito.
    if (formReady) {
      setStatus('reading');
      setOutcome('');
      setPlan(null);
      setError('');
      const searchQuery = [
        formDraft.requestType,
        formDraft.airline,
        formDraft.cityPair,
        formDraft.flightType,
        safeQuery,
      ]
        .filter(Boolean)
        .join(' ');
      const links = extractInternalLinks();
      const { pages, askLinks } = await searchWholeKb(searchQuery, links, []);
      if (!pages.length) {
        setNotice(
          'Nessun articolo pertinente trovato in Knowledge Base per questi parametri: la risposta userà solo la pagina aperta.',
        );
        pages.push(extractCurrentPage(searchQuery));
      }
      await runAsk(safeQuery, pages, askLinks, { kind: 'schedule-change', ...formDraft });
      return;
    }

    if (mode === 'visual') {
      teardownFx();
      // A user-initiated run is authoritative: reset the reentrancy guard and
      // drop any leftover/stale tour so a fresh visual run always starts, even
      // if a previous driveTour left drivingRef stuck (see Bug 0). Safe because
      // the button is disabled while busy, so no live loop can be running here.
      drivingRef.current = false;
      tourAbortRef.current = false;
      await clearTour();
      await clearTourResult();
      setStatus('reading');
      setOutcome('');
      setPlan(null);
      setError('');
      setTourDetail('');
      setStopping(false);
      const t = startTour(safeQuery);
      await driveTour(t);
      return;
    }

    setStatus('reading');
    const current = extractCurrentPage(safeQuery);
    const links = extractInternalLinks();
    const pages: KbPage[] = [current];
    let askLinks = links;

    if (mode === 'follow') {
      // I candidati non vengono solo dai link della pagina ma dall'intero indice
      // KB (a costo-token zero): l'articolo giusto emerge anche se non è linkato
      // qui. Lo scoring locale fa da prefiltro, la scelta finale la fa `/rank`.
      const found = await searchWholeKb(safeQuery, links, pages);
      pages.push(...found.pages);
      askLinks = found.askLinks;
    } else if (isOffTopic(current, safeQuery, shortlistCandidates(links, safeQuery))) {
      // ALLARGAMENTO AUTOMATICO. La modalità Analisi Articolo legge solo la pagina
      // aperta: se la domanda non c'entra con essa, la risposta sarebbe
      // strutturalmente sbagliata. Meglio cercare in tutta la KB — e DIRLO, perché
      // un allargamento silenzioso lascerebbe l'agente senza sapere da dove viene
      // la risposta.
      const found = await searchWholeKb(safeQuery, links, pages);
      if (found.pages.length) {
        pages.push(...found.pages);
        askLinks = found.askLinks;
        setNotice('La pagina aperta non copre la domanda: ho cercato in tutta la Knowledge Base.');
      }
    }
    // Follow-up: le pagine già lette nei turni precedenti si RIUSANO invece di
    // essere rilette. Il cap lo applica il server (max_request_pages), quindi la
    // pagina corrente resta prima in lista ed è l'ultima a essere tagliata.
    // `p.text` vuoto = pagina ricostruita da un risultato di tour persistito, che
    // non porta più il corpo dell'articolo (vedi saveTourResult): rimandarla
    // costerebbe token senza aggiungere contesto.
    const reused = pagesUsed.filter(
      (p) => p.text.trim() && !pages.some((fresh) => identityOf(fresh.url) === identityOf(p.url)),
    );
    await runAsk(safeQuery, thread.length ? [...pages, ...reused] : pages, askLinks);
  }, [
    query,
    mode,
    status,
    driveTour,
    runAsk,
    searchWholeKb,
    structured,
    formDraft,
    thread.length,
    pagesUsed,
  ]);

  // Rete di sicurezza attorno a `run`. La catena fa await su lettura pagine,
  // /rank, iframe nascosti e /ask: se un qualunque passo lancia, senza questo
  // catch l'eccezione muore dentro l'onClick, `status` resta su
  // 'reading'/'streaming' e il pulsante NON torna più cliccabile — l'agente può
  // solo ricaricare la pagina. Non deve esistere un percorso che lascia la
  // sidebar bloccata in silenzio.
  const runSafely = useCallback(() => {
    void run().catch((e: unknown) => {
      console.error('[rs] ricerca interrotta da un errore inatteso:', e);
      setError('Errore inatteso durante la ricerca. Riprova; se continua, segnalalo.');
      setStatus('error');
    });
  }, [run]);

  // Unico punto di stop del tour: il pulsante nella timeline. (Prima esisteva
  // anche nel banner della pagina host, che parlava a React via evento DOM.)
  // `setStopping` dà il riscontro immediato al click, mentre l'abort vero
  // attraversa ancora animazioni e storage.
  const stopTour = useCallback(async () => {
    setStopping(true);
    tourAbortRef.current = true;
    drivingRef.current = false;
    abortRef.current?.abort();
    teardownFx();
    // Copre la corsa "stop mentre la navigazione finale sta committando": il
    // flag su storage sopravvive alla morte della pagina (vedi markTourAborted).
    await markTourAborted();
    await clearTour();
    await clearTourResult();
    setTour(null);
    setTourDetail('');
    setStopping(false);
    setStatus('idle');
  }, []);

  const startResize = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    event.preventDefault();
    const previousCursor = document.body.style.cursor;
    const previousUserSelect = document.body.style.userSelect;
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';

    const move = (pointerEvent: PointerEvent) => {
      setSidebarWidth(clampSidebarWidth(window.innerWidth - pointerEvent.clientX));
    };
    const stop = () => {
      document.body.style.cursor = previousCursor;
      document.body.style.userSelect = previousUserSelect;
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', stop);
      window.removeEventListener('pointercancel', stop);
    };

    move(event.nativeEvent);
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', stop);
    window.addEventListener('pointercancel', stop);
  }, []);

  useAutoGrow(queryRef, query);

  const busy = status === 'reading' || status === 'streaming';
  // Col form compilato non serve prosa: i campi sono la domanda.
  const canRun = Boolean(query.trim()) || (structured && isFormComplete(formDraft));
  const tourActive = tour !== null && tour.phase !== 'done' && tour.phase !== 'error';
  const hasSession = Boolean(query || outcome || plan || pagesUsed.length);
  const currentStatusLabel = statusLabel(status, mode);

  if (!open) {
    return (
      <button
        className="rs-launcher"
        type="button"
        onClick={() => setOpen(true)}
        title="Riapri Runway Surfer: il contenuto resta stabile fino al reload"
      >
        <Logo size={26} />
        <span>{hasSession ? 'Riprendi' : 'Runway Surfer'}</span>
      </button>
    );
  }

  return (
    <div
      className="rs-panel"
      style={
        {
          width: `${sidebarWidth}px`,
          // Ereditata da .rs-header: allinea la nostra banda a quella della KB.
          ...(hostHeaderHeight > 0 ? { '--rs-host-header-h': `${hostHeaderHeight}px` } : {}),
        } as React.CSSProperties
      }
    >
      <div
        className="rs-resize"
        onPointerDown={startResize}
        role="separator"
        aria-orientation="vertical"
        aria-label="Ridimensiona sidebar"
        title="Ridimensiona sidebar"
      />
      <header className="rs-header">
        <div className="rs-brand">
          <Logo size={22} />
          <span className="rs-title">Runway Surfer</span>
        </div>
        <div className="rs-header-actions">
          <span className={`rs-status rs-status-${status}`} aria-live="polite">
            <span className="rs-status-dot" aria-hidden="true" />
            <span className="rs-status-text">{currentStatusLabel}</span>
          </span>
          <button
            className="rs-close"
            type="button"
            aria-label="Chiudi sidebar"
            onClick={() => setOpen(false)}
            title="Nascondi sidebar: il contenuto resta stabile fino al reload"
          >
            <CloseIcon />
          </button>
        </div>
      </header>

      <div className="rs-body">
        {authPhase === 'checking' && <div className="rs-auth-note">Verifica sessione...</div>}
        {authPhase === 'offline' && (
          <div className="rs-offline">
            <div className="rs-offline-title">Backend non raggiungibile</div>
            <p className="rs-offline-text">{authError || BACKEND_UNREACHABLE}</p>
            <p className="rs-offline-hint">
              La tua sessione è ancora valida: non serve rifare il login, basta che il servizio
              torni raggiungibile.
            </p>
            <button className="rs-submit" onClick={() => void checkSession()}>
              Riprova
            </button>
          </div>
        )}
        {authPhase === 'loggedOut' && <LoginForm onLoggedIn={onLoggedIn} />}
        {authPhase === 'mustChange' && <ChangePasswordForm onChanged={onLoggedIn} />}
        {authPhase === 'in' && (
          <>
            <span className="rs-label" id="rs-mode-label">
              Modalità
            </span>
            <div className="rs-segmented" role="radiogroup" aria-labelledby="rs-mode-label">
              {MODES.map((m) => (
                <button
                  key={m.value}
                  className={`rs-seg${mode === m.value ? ' is-active' : ''}`}
                  type="button"
                  role="radio"
                  aria-checked={mode === m.value}
                  disabled={busy}
                  title={m.hint}
                  onClick={() => setMode(m.value)}
                >
                  {m.label}
                </button>
              ))}
            </div>

            {/* Compare SOLO col provider finto. Prima era un banner fisso che
                l'agente avrebbe letto ogni giorno in produzione: informazione
                per noi, rumore per lui. */}
            {plan?.provider === 'mock' && (
              <div className="rs-provider-note">
                <strong>Modalità dimostrativa.</strong> Le risposte non arrivano dall’AI reale.
              </div>
            )}

            {/* Il caso Schedule Change non è una domanda in prosa: è un insieme
                di campi. L'interruttore scambia il box libero con il form. */}
            <div className="rs-switch-row">
              <span id="rs-structured-label">È un caso Schedule Change?</span>
              <button
                className={`rs-switch${structured ? ' is-on' : ''}`}
                type="button"
                role="switch"
                aria-checked={structured}
                aria-labelledby="rs-structured-label"
                disabled={busy}
                onClick={() => setStructured((on) => !on)}
              >
                <span className="rs-switch-knob" aria-hidden="true" />
              </button>
            </div>

            <label className="rs-label" htmlFor="rs-query">
              {structured ? 'Nota per la ricerca (opzionale)' : 'Ricerca con Runway Surfer'}
            </label>
            <textarea
              id="rs-query"
              className="rs-input"
              ref={queryRef}
              rows={1}
              // I placeholder insegnano cosa scrivere: nessuno dei due invita a
              // incollare dati del cliente. Chiedi la regola, non il caso.
              placeholder={
                structured
                  ? 'es. il cliente ha già accettato la riprotezione'
                  : 'es. si può cambiare il nome sul biglietto dopo il check-in?'
              }
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) runSafely();
              }}
            />

            {structured && (
              <ScheduleChangeForm draft={formDraft} onChange={setFormDraft} disabled={busy} />
            )}

            <div className="rs-actions">
              <button className="rs-submit" onClick={runSafely} disabled={busy || !canRun}>
                {status === 'reading'
                  ? mode === 'visual'
                    ? 'Tour in corso...'
                    : 'Lettura pagina...'
                  : status === 'streaming'
                    ? 'Generazione...'
                    : 'Ricerca'}
              </button>
              <button
                className="rs-secondary rs-new"
                type="button"
                aria-label="Nuova ricerca"
                title="Nuova ricerca: azzera domanda e risposta"
                onClick={() => void resetSession()}
                disabled={busy || !hasSession}
              >
                +
              </button>
            </div>

            {tourActive && (
              <TourTimeline
                tour={tour}
                pagesUsed={pagesUsed}
                detail={tourDetail}
                onStop={() => void stopTour()}
                stopping={stopping}
              />
            )}

            {/* Un agente al telefono non deve leggere "Stima costo $0.0004" né
                l'host di egress: sono dati per il CED, e stanno nella dashboard.
                Qui resta ciò che gli dice qualcosa — quante pagine ha letto e se
                la risposta tiene conto dei turni precedenti. Il dettaglio tecnico
                completo torna a schermo solo con `rs:debug` in storage. */}
            {plan && (
              <div className="rs-plan" title="Come è stata costruita questa risposta">
                <div className="rs-plan-row">
                  <span>Fonti lette</span>
                  <strong>
                    {pagesUsed.length === 1 ? '1 articolo' : `${pagesUsed.length} articoli`}
                  </strong>
                </div>
                {plan.historyTurnsUsed ? (
                  <div className="rs-plan-row">
                    <span>Contesto</span>
                    <strong>
                      {plan.historyTurnsUsed === 1
                        ? '1 turno precedente'
                        : `${plan.historyTurnsUsed} turni precedenti`}
                    </strong>
                  </div>
                ) : null}
                {debug && (
                  <>
                    <div className="rs-plan-row">
                      <span>Modello</span>
                      <strong>{plan.model}</strong>
                    </div>
                    <div className="rs-plan-row">
                      <span>Stima token</span>
                      <strong>
                        {plan.estimatedInputTokens} in / {plan.estimatedOutputTokens} out
                      </strong>
                    </div>
                    <div className="rs-plan-row">
                      <span>Stima costo</span>
                      <strong>${plan.estimatedCostUsd.toFixed(4)}</strong>
                    </div>
                    <div className="rs-plan-row">
                      <span>Egress</span>
                      <code>{plan.egress}</code>
                    </div>
                    <div className="rs-plan-reason">{plan.routingReason}</div>
                  </>
                )}
              </div>
            )}

            {error && <div className="rs-error">{error}</div>}
            {redaction && (
              <div className="rs-notice" role="status">
                {redaction}
              </div>
            )}
            {notice && (
              <div className="rs-notice" role="status">
                {notice}
              </div>
            )}

            <ThreadView turns={thread} pages={pagesUsed} contextTurns={plan?.historyTurnsUsed} />

            {outcome && (
              <article className="rs-outcome">
                <OutcomeView outcome={outcome} pages={pagesUsed} />
              </article>
            )}

            {pagesUsed.length > 0 && (
              <details className="rs-pages">
                <summary>
                  {pagesUsed.length === 1 ? '1 pagina letta' : `${pagesUsed.length} pagine lette`}
                </summary>
                <ul>
                  {pagesUsed.map((p) => (
                    <li key={p.url}>
                      <span className={`rs-badge rs-${p.origin}`}>{p.origin}</span>{' '}
                      <a
                        className="rs-page-link"
                        href={p.url}
                        target="_blank"
                        rel="noopener noreferrer"
                      >
                        {p.title}
                      </a>
                    </li>
                  ))}
                </ul>
              </details>
            )}
          </>
        )}
      </div>

      {/* Fuori da .rs-body, così resta ancorato in basso invece di scorrere via
          insieme a una risposta lunga. */}
      {authPhase === 'in' && (
        <footer className="rs-footer">
          <span className="rs-footer-user" title={me?.username}>
            {me?.name || me?.username}
          </span>
          <button
            className="rs-logout"
            type="button"
            onClick={() => {
              void resetSession();
              void doLogout();
            }}
          >
            Logout
          </button>
        </footer>
      )}
    </div>
  );
}
