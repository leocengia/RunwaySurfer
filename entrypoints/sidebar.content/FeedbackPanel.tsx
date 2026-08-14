// Feedback dell'agente sulla risposta appena ricevuta.
//
// Progettato per essere usato DAVVERO: due click bastano (pollice + Invia) e il
// commento è opzionale. Un form lungo, al telefono con un cliente, resta vuoto —
// e un canale di feedback che nessuno usa non produce il dato per cui esiste.
//
// Il contesto (id richiesta, modello, modalità, domanda) viene allegato da solo:
// chiedere all'agente di ricordare "a quale risposta" si riferisce sarebbe un modo
// sicuro di raccogliere segnalazioni inutilizzabili.
import { useState } from 'react';
import { redactionNotice, scrubPii } from '../../lib/scrub';

export interface FeedbackDraftContext {
  /** Domanda a cui si riferisce, per farla riconoscere all'agente. */
  query: string;
  /** Assente = segnalazione generica, non legata a una risposta. */
  requestId?: string;
}

interface Props {
  context: FeedbackDraftContext | null;
  onClose: () => void;
  /** Ritorna false se l'invio non è riuscito: il pannello lo dice e resta aperto. */
  onSend: (rating: 'up' | 'down', comment: string) => Promise<boolean>;
}

export function FeedbackPanel({ context, onClose, onSend }: Props) {
  const [rating, setRating] = useState<'up' | 'down' | null>(null);
  const [comment, setComment] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  // Il commento è testo libero scritto al telefono: è il posto più probabile in
  // cui finisca un dato del cliente. Si redige come la domanda, e si DICE.
  const scrubbed = scrubPii(comment);
  const redaction = redactionNotice(scrubbed.redacted);

  const submit = async () => {
    if (!rating) {
      setError('Scegli prima se la risposta è stata utile.');
      return;
    }
    setBusy(true);
    setError('');
    const ok = await onSend(rating, scrubbed.text);
    setBusy(false);
    if (ok) onClose();
    else setError('Invio non riuscito. Riprova più tardi: il tuo lavoro non è stato interrotto.');
  };

  return (
    <section className="rs-feedback" aria-label="Invia un feedback">
      <div className="rs-feedback-head">
        <strong>Com’è andata?</strong>
        <button className="rs-feedback-close" type="button" onClick={onClose} aria-label="Chiudi">
          ×
        </button>
      </div>

      {context?.requestId ? (
        <p className="rs-feedback-ref" title={context.query}>
          Sulla risposta a: <em>{context.query}</em>
        </p>
      ) : (
        <p className="rs-feedback-ref">
          Segnalazione generale (nessuna risposta a cui riferirsi in questo momento).
        </p>
      )}

      <div className="rs-feedback-rating" role="radiogroup" aria-label="Giudizio">
        <button
          className={`rs-feedback-vote${rating === 'up' ? ' is-on' : ''}`}
          type="button"
          role="radio"
          aria-checked={rating === 'up'}
          disabled={busy}
          onClick={() => setRating('up')}
        >
          👍 Utile
        </button>
        <button
          className={`rs-feedback-vote${rating === 'down' ? ' is-on' : ''}`}
          type="button"
          role="radio"
          aria-checked={rating === 'down'}
          disabled={busy}
          onClick={() => setRating('down')}
        >
          👎 Non utile
        </button>
      </div>

      <label className="rs-label" htmlFor="rs-feedback-comment">
        Cosa non ha funzionato? (opzionale)
      </label>
      <textarea
        id="rs-feedback-comment"
        className="rs-input"
        rows={2}
        placeholder="es. la procedura indicata non è quella del vettore"
        value={comment}
        disabled={busy}
        onChange={(e) => setComment(e.target.value)}
      />

      {redaction && (
        <div className="rs-notice" role="status">
          {redaction}
        </div>
      )}
      {error && <div className="rs-error">{error}</div>}

      <button className="rs-submit" type="button" disabled={busy} onClick={() => void submit()}>
        {busy ? 'Invio...' : 'Invia'}
      </button>
    </section>
  );
}
