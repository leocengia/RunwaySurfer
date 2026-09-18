// Risolve QUALE modello concreto risponde a ciascuna fascia di difficoltà
// (router.ts decide solo la fascia, mai il modello) e allo slot del reranker.
//
// Con AI_PROVIDER=anthropic (o mock) le tre fasce sono FACOLTATIVE: senza
// nulla impostato si usano i tre modelli Claude di ANTHROPIC_MODELS, esatti
// id e prezzi di sempre. Con AI_PROVIDER=openrouter sono OBBLIGATORIE: un
// catalogo multi-fornitore (Anthropic, OpenAI, Google, Meta...) non ha un
// prezzo "di base" che il servizio possa indovinare — dichiarare id e prezzo
// insieme è ciò che rende `estimateCostUsd()` (router.ts, generica, invariata)
// corretta anche per un modello mai visto da questo codice.
//
// Puro come config.ts/router.ts: nessun accesso al filesystem, nessun
// process.exit, nessun throw. Gli errori tornano come lista e finiscono in
// CONFIG_ERRORS (config.ts), stampati da index.ts col prefisso [config].
import type { ModelSpec } from './router.js';
import { ANTHROPIC_MODELS } from './router.js';

export interface ModelRegistry {
  cheap: ModelSpec;
  balanced: ModelSpec;
  capable: ModelSpec;
  /** Modello del reranker (POST /rank): uno slot a parte, non una fascia di difficoltà. */
  rerank: ModelSpec;
}

/** Vuoto e assente sono la stessa cosa — stessa convenzione di config.ts:str(). */
function str(env: NodeJS.ProcessEnv, name: string): string | undefined {
  const raw = env[name];
  if (raw === undefined) return undefined;
  const trimmed = raw.trim();
  return trimmed === '' ? undefined : trimmed;
}

interface SlotOptions {
  /** Con AI_PROVIDER=openrouter le tre fasce sono obbligatorie: nessun default sensato esiste. */
  required?: boolean;
  /**
   * Solo il reranker: un id da solo (senza prezzi) è tollerato, come oggi con
   * RANK_MODEL="qualcosa" per un esperimento rapido — il prezzo si approssima
   * con quello del fallback (la fascia 'cheap' già risolta), la stima di costo
   * sarà imprecisa se il modello sperimentale ha un prezzo diverso, ma non si
   * blocca l'avvio per un override pensato per un test veloce. Le tre fasce
   * "serie" (cheap/balanced/capable) restano invece strette: o tutti e tre
   * (id + 2 prezzi) o nessuno.
   */
  lenient?: boolean;
}

/**
 * Risolve uno slot dalle env `<prefix>`, `<prefix>_INPUT_PER_MTOK`,
 * `<prefix>_OUTPUT_PER_MTOK`. Le tre vanno impostate INSIEME (tranne lo slot
 * lenient, vedi sopra): mezza configurazione non è un default plausibile —
 * stessa regola già usata per TLS_CERT_PATH/TLS_KEY_PATH in config.ts.
 */
function resolveSlot(
  env: NodeJS.ProcessEnv,
  prefix: string,
  fallback: ModelSpec,
  errors: string[],
  opts: SlotOptions = {},
): ModelSpec {
  const id = str(env, prefix);
  const inputRaw = str(env, `${prefix}_INPUT_PER_MTOK`);
  const outputRaw = str(env, `${prefix}_OUTPUT_PER_MTOK`);

  if (id === undefined && inputRaw === undefined && outputRaw === undefined) {
    if (opts.required) {
      errors.push(
        `${prefix} (e ${prefix}_INPUT_PER_MTOK / ${prefix}_OUTPUT_PER_MTOK) sono obbligatorie con ` +
          "AI_PROVIDER=openrouter: un catalogo multi-fornitore non ha un prezzo 'di base' che il " +
          'servizio possa indovinare — imposta il modello che vuoi usare per questa fascia e il suo prezzo.',
      );
    }
    return fallback;
  }

  if (opts.lenient && id !== undefined && inputRaw === undefined && outputRaw === undefined) {
    return { id, inputPerMTok: fallback.inputPerMTok, outputPerMTok: fallback.outputPerMTok };
  }

  if (id === undefined || inputRaw === undefined || outputRaw === undefined) {
    errors.push(
      `${prefix}: id e prezzi vanno impostati INSIEME (${prefix}=${id ?? 'mancante'}, ` +
        `${prefix}_INPUT_PER_MTOK=${inputRaw ?? 'mancante'}, ${prefix}_OUTPUT_PER_MTOK=${outputRaw ?? 'mancante'}) ` +
        '— mezza configurazione non è un default plausibile.',
    );
    return fallback;
  }

  const inputPerMTok = Number(inputRaw);
  if (!Number.isFinite(inputPerMTok) || inputPerMTok < 0) {
    errors.push(
      `${prefix}_INPUT_PER_MTOK deve essere un numero >= 0 (valore attuale: "${inputRaw}").`,
    );
    return fallback;
  }
  const outputPerMTok = Number(outputRaw);
  if (!Number.isFinite(outputPerMTok) || outputPerMTok < 0) {
    errors.push(
      `${prefix}_OUTPUT_PER_MTOK deve essere un numero >= 0 (valore attuale: "${outputRaw}").`,
    );
    return fallback;
  }
  return { id, inputPerMTok, outputPerMTok };
}

/**
 * `providerKind` come stringa semplice (non il tipo di config.ts): evita un
 * ciclo d'importazione — config.ts chiama questa funzione per costruire
 * MODEL_REGISTRY, quindi non può esserne anche il fornitore di tipi.
 */
export function resolveModelRegistry(
  env: NodeJS.ProcessEnv,
  providerKind: string,
): { registry: ModelRegistry; errors: string[] } {
  const errors: string[] = [];
  const required = providerKind === 'openrouter';

  const cheap = resolveSlot(env, 'MODEL_CHEAP', ANTHROPIC_MODELS.cheap, errors, { required });
  const balanced = resolveSlot(env, 'MODEL_BALANCED', ANTHROPIC_MODELS.balanced, errors, {
    required,
  });
  const capable = resolveSlot(env, 'MODEL_CAPABLE', ANTHROPIC_MODELS.capable, errors, { required });
  // Eredita 'cheap' GIÀ RISOLTO (non il default Anthropic grezzo): con
  // openrouter configurato, un RANK_MODEL non impostato usa il modello
  // economico OpenRouter scelto per quella fascia, non un Claude cablato.
  const rerank = resolveSlot(env, 'RANK_MODEL', cheap, errors, { lenient: true });

  return { registry: { cheap, balanced, capable, rerank }, errors };
}
