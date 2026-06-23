# RunwaySurfer — Requisiti backend (per il CED)

Documento di riferimento per dimensionare l'infrastruttura del **proxy backend
on-premise**. Sintetizza ciò che la demo rende anche interrogabile a runtime via
`GET /requirements`.

## Cos'è il backend
Un **proxy stateless** in Node.js che:
1. riceve dalla sidebar `{query, pages, links}`;
2. sceglie il modello AI in base alla difficoltà (routing → contenimento costi);
3. costruisce il prompt e (in produzione) chiama l'API Anthropic in streaming;
4. custodisce la **API key** (mai nell'estensione distribuita agli agenti).

> In **demo** (`AI_PROVIDER=mock`) NON viene effettuata alcuna chiamata esterna:
> utile per validare architettura e requisiti senza licenze/token.

## Risorse di calcolo
| Voce | Prototipo/demo | Note produzione (30 agenti) |
|------|----------------|------------------------------|
| CPU  | 1 vCPU | I/O bound; scalare orizzontalmente se serve |
| RAM  | 256–512 MB | processo singolo, stateless |
| Disco| minimo | nessuna persistenza; solo log opzionali |
| Runtime | Node.js 20+ | deploy via Docker o systemd |

## Rete
| Direzione | Requisito |
|-----------|-----------|
| **Inbound** | porta HTTP (default `8787`) raggiungibile dai browser degli agenti; **esporre via reverse proxy con TLS** (es. Nginx/Traefik) |
| **Outbound (egress)** | **HTTPS verso `api.anthropic.com:443`** — necessario SOLO con provider reale; in demo nessun egress |
| CORS | `Access-Control-Allow-Origin` = origin dell'estensione (in demo `*`) |

## Segreti
- `ANTHROPIC_API_KEY` fornita via variabile d'ambiente / secret manager **sul
  server**; **mai** inclusa nel bundle dell'estensione.
- Ruotabile senza redeploy dell'estensione (la chiave vive solo nel backend).

## Sicurezza / hardening (consigliato)
- Esecuzione come utente dedicato non privilegiato (vedi `deploy/runwaysurfer.service`).
- TLS terminato dal reverse proxy; backend in rete interna.
- Egress in allowlist verso il solo host Anthropic.

## Punti aperti da chiarire col CED
- Posizionamento (DMZ / rete interna) e policy di egress verso Internet.
- Reverse proxy/TLS aziendale standard da utilizzare.
- Gestione segreti aziendale (vault) per `ANTHROPIC_API_KEY`.
- Logging/retention dei log d'uso (costi/token per agente).
