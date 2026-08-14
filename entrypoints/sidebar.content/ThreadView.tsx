// Turni conclusi della conversazione.
//
// Prima ogni domanda azzerava la risposta precedente (`setOutcome('')` a ogni
// giro), quindi un approfondimento cancellava ciò che l'agente stava leggendo e
// il modello ripartiva da zero. Qui i turni chiusi restano a schermo, collassati
// per non rubare spazio al turno corrente, e tornano al modello come contesto.
import type { AskTurn, KbPage } from '../../lib/outcome';
import { OutcomeView } from './OutcomeView';

export interface ThreadViewProps {
  turns: AskTurn[];
  pages: KbPage[];
  /** Turni che il backend rimanderà davvero al modello (setting max_history_turns). */
  contextTurns?: number;
}

export function ThreadView({ turns, pages, contextTurns }: ThreadViewProps) {
  if (!turns.length) return null;
  // Oltre il tetto i turni più vecchi restano leggibili ma non sono più contesto:
  // dirlo evita che l'agente creda che il modello ricordi tutto.
  const droppedCount = contextTurns ? Math.max(0, turns.length - contextTurns) : 0;

  return (
    <section className="rs-thread" aria-label="Domande precedenti della conversazione">
      {turns.map((turn, i) => (
        <details key={i} className="rs-turn">
          <summary>
            <span className="rs-turn-index">{i + 1}</span>
            <span className="rs-turn-query">{turn.query}</span>
            {i < droppedCount && (
              <span className="rs-turn-stale" title="Fuori dalla memoria rimandata al modello">
                fuori memoria
              </span>
            )}
          </summary>
          <div className="rs-turn-answer">
            <OutcomeView outcome={turn.answer} pages={pages} />
          </div>
        </details>
      ))}
    </section>
  );
}
