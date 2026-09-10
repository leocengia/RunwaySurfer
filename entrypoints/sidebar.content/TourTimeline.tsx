// Timeline del tour visivo nella sidebar.
//
// Sostituisce la riga singola "Tour visivo - passo 2/3": durante le attese SPA
// (fino a 9s ciascuna, due per articolo) una riga statica non dice se qualcosa
// si stia muovendo. Qui i passi sono noti in anticipo (TourState.targets), lo
// stato di ciascuno è derivato da tour.index/phase, e la riga corrente porta il
// dettaglio live che arriva da waitForSpaRender.
//
// È anche l'unico posto da cui si interrompe il tour: il pulsante è stato
// spostato qui dal banner nella pagina host.
import type { KbPage } from '../../lib/outcome';
import { normalizeUrl, type TourState } from '../../lib/tour';

type StepState = 'done' | 'skipped' | 'current' | 'pending';

export interface TourTimelineProps {
  tour: TourState;
  pagesUsed: KbPage[];
  /** Dettaglio live del passo corrente (render SPA, caratteri letti, ...). */
  detail: string;
  onStop: () => void;
  stopping: boolean;
}

/** Un target è "letto" solo se una pagina con lo stesso URL è finita in pagesUsed. */
function wasRead(url: string, pagesUsed: KbPage[]): boolean {
  const want = normalizeUrl(url);
  return pagesUsed.some((p) => p.origin === 'followed' && normalizeUrl(p.url) === want);
}

function stepState(index: number, tour: TourState, pagesUsed: KbPage[]): StepState {
  // In fase 'asking' il cammino è finito: ogni target è già stato oltrepassato.
  if (tour.phase !== 'asking') {
    if (index === tour.index) return 'current';
    if (index > tour.index) return 'pending';
  }
  // Passo già oltrepassato: distinguere letto da saltato (link non trovato in
  // pagina, o render non riuscito) evita di dichiarare letto ciò che non lo è.
  return wasRead(tour.targets[index]?.url ?? '', pagesUsed) ? 'done' : 'skipped';
}

const STATE_LABEL: Record<StepState, string> = {
  done: 'letto',
  skipped: 'saltato',
  current: 'in corso',
  pending: 'in attesa',
};

export function TourTimeline({ tour, pagesUsed, detail, onStop, stopping }: TourTimelineProps) {
  const total = tour.targets.length;
  const asking = tour.phase === 'asking';
  const readCount = pagesUsed.filter((p) => p.origin === 'followed').length;

  return (
    <section className="rs-timeline" aria-label="Avanzamento della modalità immersiva">
      <div className="rs-timeline-head">
        <span>Modalità immersiva</span>
        <span className="rs-timeline-count">
          {asking ? 'analisi' : `passo ${Math.min(tour.index + 1, total)}/${total}`}
        </span>
      </div>

      <ul className="rs-timeline-list">
        {tour.targets.map((target, index) => {
          const state = stepState(index, tour, pagesUsed);
          return (
            <li key={`${target.url}-${index}`} className={`rs-tl-item rs-tl-${state}`}>
              <span className="rs-tl-dot" aria-hidden="true" />
              <span>
                <span className="rs-tl-title">
                  {state === 'done' ? (
                    <a
                      className="rs-tl-link"
                      href={target.url}
                      target="_blank"
                      rel="noopener noreferrer"
                    >
                      {target.text}
                    </a>
                  ) : (
                    target.text
                  )}
                </span>
                <span className="rs-tl-detail">
                  {state === 'current' && detail ? detail : STATE_LABEL[state]}
                </span>
              </span>
            </li>
          );
        })}

        <li className={`rs-tl-item rs-tl-${asking ? 'current' : 'pending'}`}>
          <span className="rs-tl-dot" aria-hidden="true" />
          <span>
            <span className="rs-tl-title">Analisi e risposta</span>
            <span className="rs-tl-detail">
              {asking ? detail || 'scrivo la risposta...' : 'in attesa'}
            </span>
          </span>
        </li>
      </ul>

      <div className="rs-timeline-foot">
        <span aria-live="polite">
          {readCount === 1 ? '1 pagina letta' : `${readCount} pagine lette`}
        </span>
        <button className="rs-abort" type="button" onClick={onStop} disabled={stopping}>
          {stopping ? 'Interrompo...' : 'Interrompi'}
        </button>
      </div>
    </section>
  );
}
