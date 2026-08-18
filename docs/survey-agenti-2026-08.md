# Sondaggio agenti, agosto 2026 — cosa ci ha detto

Nove agenti hanno risposto al questionario distribuito a fine luglio 2026. Tre
domande a testa su «cosa digiteresti davvero» hanno prodotto **27 risposte, 26
query distinte**: la prima misura reale di come si usa RunwaySurfer, invece di
come immaginavamo che si usasse.

Il verdetto è più severo di qualunque miglioria all'interfaccia avessimo in coda:
**19 delle 27 non arrivavano all'articolo giusto**, e in silenzio. Non è un
problema di modello né di prompt. È che la Knowledge Base è organizzata in un modo
che il prefiltro non capiva, e che gli agenti scrivono in un modo che il
tokenizzatore buttava via.

## Dove stanno le query

Nel fixture versionato **[`tests/fixtures/survey-queries-2026-08.json`](../tests/fixtures/survey-queries-2026-08.json)**,
verbatim e con i refusi. È la fonte unica: la usano
[`docs/build-eval-report.mts`](build-eval-report.mts) per generare il documento da
etichettare e [`tests/rank-eval.test.ts`](../tests/rank-eval.test.ts) come guard.
L'`.xlsx` originale vive fuori dal repo e non va usato come sorgente di codice.

I refusi sono tenuti **apposta**: `FRO` per FOR, `SAFTY` per SAFETY. È quello che
gli agenti digitano davvero, quindi è quello che il retrieval deve reggere.

## I numeri

| | |
| --- | --- |
| Risposte | 9 |
| Query utilizzabili | 27 (26 distinte: una ripetuta dallo stesso rispondente) |
| Lingua di ricerca | Italiano 4 · Inglese 3 · Entrambe 1 |
| Aree | BEX 8 · HCOM 6 · PLS 4 · GDPR 1 |
| Cosa serve in una risposta | **la procedura 7** · le eccezioni 3 · **il link 3** |
| Vettore citato nella query | Lufthansa **6** · LH 2 · TK 1 · LHG 1 · Emirates 1 |
| Acronimi usati | ASC **4** · NDC **3** · EMEA 2 |
| Richieste di elenco esaustivo | 3 |
| Refusi | 2 |

Tre agenti su nove hanno detto che **il link è ciò che serve di più**: non un
riassunto, l'articolo. È il dato che motiva la Fase C3.

## Le cinque cause, e cosa ne è stato

Tutte verificate sull'indice reale, non stimate.

| Causa | Query colpite | Stato |
| --- | --- | --- |
| La KB archivia i vettori per **intervallo alfabetico** (`… policies I L`), e il nome cercato non è nel titolo: 48 articoli in 21 famiglie | 6 | risolta ([`lib/kb-ranges.ts`](../lib/kb-ranges.ts)) |
| Gli **acronimi** ≤3 caratteri venivano scartati dal tokenizzatore: ASC, NDC, LH, TK, LHG | 9 | risolta, con confine di parola perché `asc` come sottostringa prende *Madagascar* |
| Le **flessioni** italiane e `policy`/`policies` non matchavano: l'alias deve stare dentro la query | ~6 | risolta (dati in [`lib/kb-vocab.ts`](../lib/kb-vocab.ts)) |
| La risposta è **sempre in italiano**, per 3 agenti su 9 che cercano in inglese | — | Fase C2 |
| Le risposte **tagliate** non lo dicono: `stop_reason` c'era e lo buttavamo | 3 | Fase C4 |

Le somme superano 27 perché diverse query hanno più di una causa.

### Il caso che spiega tutto

> **«ASC lufthansa policy»** → l'articolo giusto è `Global airline schedule change
> policies I L`, perché Lufthansa comincia per **L**.

Quel titolo non contiene né «lufthansa» né «ASC». Valeva **zero** per due ragioni
sovrapposte: `asc` era sotto la soglia dei 4 caratteri, e `policy` non è
sottostringa di `policies` (109 label contro 57). Sistemate quelle, la famiglia
sale a punteggio pieno — e poi serve scegliere *quale* dei sei fratelli, che è il
lavoro dell'iniziale.

## Cosa resta fuori, dichiarato

- **Tolleranza ai refusi.** `SAFTY` → `SAFETY` richiederebbe una distanza di edit
  contro i termini dell'indice, applicata solo come recupero. Vale la pena **dopo**
  aver misurato: nel frattempo si è visto che la domanda che contiene `SAFTY` trova
  comunque 104 candidati grazie alle altre parole, quindi il refuso pesa meno di
  quanto sembrasse.
- **`tier` in accezione loyalty.** I 30 label con «tier» sono tutti escalation
  interna (`When to escalate to Tier 3`). L'articolo su notti e livelli Hotels.com
  probabilmente non è nell'indice: è una domanda per chi cura la KB. E dall'evidenza
  di retrieval `tier` appare *identico* a `ndc`, che invece è preciso — quindi
  nemmeno l'avviso può distinguerli.
- **`punti cash` / accumulo notti.** Stessa famiglia del punto sopra.

## Il passo successivo

[`docs/EVAL-DA-ETICHETTARE.md`](EVAL-DA-ETICHETTARE.md) — generato, non scritto a
mano. Per ogni domanda i primi candidati con punteggio e motivo, e una casella da
spuntare. Le spunte diventano goldens `curated`, e da quel momento
`npx vitest run tests/rank-eval.test.ts` dà `recall@40` sulle query vere: la prima
volta che un miglioramento al retrieval è misurabile invece che plausibile.
