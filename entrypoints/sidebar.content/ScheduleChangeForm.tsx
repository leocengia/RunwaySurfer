// Form della richiesta strutturata (Schedule Change / Name Correction).
//
// Uno Schedule Change non è una domanda in prosa: è un insieme di campi. Farli
// compilare dà al modello dati puliti e all'agente un percorso guidato, invece di
// sperare che descriva il caso con le parole giuste.
//
// Il valore vive nel componente padre (App), così `run()` lo invia senza dover
// leggere il DOM: i campi sono controllati e la validazione minima sta qui.
import { SCHEDULE_CHANGE_FIELDS, type ScheduleChangeRequest } from '../../lib/outcome';

export type FormDraft = Omit<ScheduleChangeRequest, 'kind'>;

/** Bozza vuota: tutte le sezioni di output selezionate, com'è il default richiesto. */
export function emptyFormDraft(): FormDraft {
  return {
    requestType: 'Schedule Change',
    airline: '',
    cityPair: '',
    flightType: 'Online',
    originalDate: '',
    sections: SCHEDULE_CHANGE_FIELDS.map((f) => f.label),
  };
}

/** Campi minimi perché la richiesta abbia senso da mandare al modello. */
export function isFormComplete(draft: FormDraft): boolean {
  return Boolean(draft.airline.trim() && draft.cityPair.trim() && draft.originalDate);
}

export interface ScheduleChangeFormProps {
  draft: FormDraft;
  onChange: (draft: FormDraft) => void;
  disabled: boolean;
}

export function ScheduleChangeForm({ draft, onChange, disabled }: ScheduleChangeFormProps) {
  const patch = (part: Partial<FormDraft>) => onChange({ ...draft, ...part });

  const toggleSection = (label: string) => {
    const has = draft.sections.includes(label);
    // L'ULTIMA casella non si può togliere. Con `sections: []` il server tratta la
    // lista come "non richiesto" e ricade sulle sezioni standard
    // (Procedura/Eccezioni/Risposta): una richiesta Schedule Change riceverebbe in
    // silenzio una risposta di forma completamente diversa da quella attesa.
    if (has && draft.sections.length === 1) return;
    patch({
      sections: has
        ? draft.sections.filter((s) => s !== label)
        : // Riordina sull'elenco canonico: l'ordine dei campi non deve dipendere
          // da quello in cui l'agente li ha spuntati.
          SCHEDULE_CHANGE_FIELDS.filter(
            (f) => f.label === label || draft.sections.includes(f.label),
          ).map((f) => f.label),
    });
  };

  return (
    <div className="rs-form">
      <label className="rs-form-row">
        <span className="rs-form-label">Request Type</span>
        <select
          className="rs-field"
          value={draft.requestType}
          disabled={disabled}
          onChange={(e) => patch({ requestType: e.target.value as FormDraft['requestType'] })}
        >
          <option value="Schedule Change">Schedule Change</option>
          <option value="Name Correction">Name Correction</option>
        </select>
      </label>

      <div className="rs-form-pair">
        <label className="rs-form-row">
          <span className="rs-form-label">Airline</span>
          <input
            className="rs-field"
            value={draft.airline}
            disabled={disabled}
            placeholder="LH"
            maxLength={8}
            autoCapitalize="characters"
            onChange={(e) => patch({ airline: e.target.value.toUpperCase() })}
          />
        </label>
        <label className="rs-form-row">
          <span className="rs-form-label">Original flight date</span>
          <input
            className="rs-field"
            type="date"
            value={draft.originalDate}
            disabled={disabled}
            onChange={(e) => patch({ originalDate: e.target.value })}
          />
        </label>
      </div>

      <label className="rs-form-row">
        <span className="rs-form-label">Impacted Itinerary (City Pair)</span>
        <input
          className="rs-field"
          value={draft.cityPair}
          disabled={disabled}
          placeholder="MIL-PAR oppure Milano-Parigi"
          onChange={(e) => patch({ cityPair: e.target.value })}
        />
        <span className="rs-form-hint">
          Sigle o nomi di città: la conversione la fa il backend.
        </span>
      </label>

      <div className="rs-form-row">
        <span className="rs-form-label" id="rs-flight-type">
          Flight Type
        </span>
        <div className="rs-segmented" role="radiogroup" aria-labelledby="rs-flight-type">
          {(['Online', 'Codeshare'] as const).map((value) => (
            <button
              key={value}
              className={`rs-seg${draft.flightType === value ? ' is-active' : ''}`}
              type="button"
              role="radio"
              aria-checked={draft.flightType === value}
              disabled={disabled}
              onClick={() => patch({ flightType: value })}
            >
              {value}
            </button>
          ))}
        </div>
      </div>

      <fieldset className="rs-form-sections" disabled={disabled}>
        <legend className="rs-form-label">Da includere nella risposta</legend>
        {SCHEDULE_CHANGE_FIELDS.map((field) => {
          const checked = draft.sections.includes(field.label);
          const isLast = checked && draft.sections.length === 1;
          return (
            <label key={field.id} className="rs-check">
              <input
                type="checkbox"
                checked={checked}
                // L'ultima resta bloccata: senza almeno un campo la risposta
                // cambierebbe forma senza dirlo (vedi toggleSection).
                disabled={isLast}
                title={isLast ? 'Almeno un campo deve restare selezionato' : undefined}
                onChange={() => toggleSection(field.label)}
              />
              <span>{field.label}</span>
            </label>
          );
        })}
      </fieldset>
    </div>
  );
}
