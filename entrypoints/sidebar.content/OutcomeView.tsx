// Resa della risposta markdown dell'AI.
//
// Componente separato perché serve in due posti: la risposta in streaming e ogni
// turno concluso del thread. Il parsing sta in lib/sources.ts (puro e testato):
// qui si trasformano solo blocchi in nodi.
//
// Nessun percorso da testo del modello a `innerHTML`: il grassetto arriva già
// segmentato come dati, quindi non esiste superficie di injection.
import { buildOutcomeBlocks, type InlineSegment } from '../../lib/sources';
import type { KbPage } from '../../lib/outcome';

function Inline({ segments }: { segments: InlineSegment[] }) {
  return (
    <>
      {segments.map((segment, i) =>
        segment.bold ? (
          <strong key={i}>{segment.text}</strong>
        ) : (
          <span key={i}>{segment.text}</span>
        ),
      )}
    </>
  );
}

export function OutcomeView({ outcome, pages }: { outcome: string; pages: KbPage[] }) {
  return (
    <>
      {buildOutcomeBlocks(outcome, pages).map((block, i) => {
        if (block.kind === 'heading') {
          return (
            <p key={i} className="rs-h">
              {block.text}
            </p>
          );
        }
        if (block.kind === 'list') {
          // I passi operativi arrivano come `- voce`: renderli come elenco vero
          // è la differenza fra una procedura leggibile e un muro di paragrafi.
          const Tag = block.ordered ? 'ol' : 'ul';
          return (
            <Tag key={i} className="rs-list">
              {block.items.map((item, j) => (
                <li key={j}>
                  <Inline segments={item} />
                </li>
              ))}
            </Tag>
          );
        }
        if (block.kind === 'sources') {
          // Solo il titolo, cliccabile, apre in una nuova scheda.
          return (
            <ul key={i} className="rs-sources">
              {block.sources.map((source) => (
                <li key={source.url}>
                  <a
                    className="rs-source"
                    href={source.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    title={source.url}
                  >
                    <span className="rs-source-title">{source.title}</span>
                  </a>
                </li>
              ))}
            </ul>
          );
        }
        return (
          <p key={i}>
            <Inline segments={block.inline} />
          </p>
        );
      })}
    </>
  );
}
