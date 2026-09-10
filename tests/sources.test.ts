import { describe, expect, it } from 'vitest';
import { buildOutcomeBlocks, parseInline, parseSources, type OutcomeBlock } from '../lib/sources';
import type { KbPage } from '../lib/outcome';

function page(url: string, title: string): KbPage {
  return { url, title, text: '', origin: 'followed' };
}

const A = 'https://kb.example.com/wiki/Rimborso_volo_cancellato';
const B = 'https://kb.example.com/wiki/Cambio_nome';

describe('parseSources', () => {
  it('prende titolo e URL dalle righe della sezione Fonti', () => {
    const md = `## Procedura\npassi\n## Fonti\n- Rimborso volo cancellato: ${A}\n- Cambio nome: ${B}`;
    expect(parseSources(md)).toEqual([
      { title: 'Rimborso volo cancellato', url: A },
      { title: 'Cambio nome', url: B },
    ]);
  });

  it('tiene interi i titoli che contengono i due punti', () => {
    const md = `## Fonti\n- Rimborsi: casi particolari: ${A}`;
    expect(parseSources(md)[0].title).toBe('Rimborsi: casi particolari');
  });

  it('ripiega sul titolo della pagina letta quando la riga è solo un URL', () => {
    const md = `## Fonti\n- ${A}`;
    expect(parseSources(md, [page(A, 'Rimborso volo cancellato')])).toEqual([
      { title: 'Rimborso volo cancellato', url: A },
    ]);
  });

  it('ripiega sull’ultimo segmento di path se non conosce la pagina', () => {
    expect(parseSources(`## Fonti\n- ${A}`)).toEqual([
      { title: 'Rimborso volo cancellato', url: A },
    ]);
  });

  it('ripulisce la punteggiatura finale dell’URL', () => {
    expect(parseSources(`## Fonti\n- Titolo: ${A}.`)[0].url).toBe(A);
  });

  it('deduplica per URL normalizzato (il fragment non conta)', () => {
    const md = `## Fonti\n- Titolo: ${A}\n- Stesso: ${A}#sezione`;
    expect(parseSources(md)).toHaveLength(1);
  });

  it('si ferma alla sezione successiva', () => {
    const md = `## Fonti\n- Titolo: ${A}\n## Note\n- Altro: ${B}`;
    expect(parseSources(md)).toEqual([{ title: 'Titolo', url: A }]);
  });

  it('restituisce [] senza sezione Fonti', () => {
    expect(parseSources(`## Procedura\nvedi ${A}`)).toEqual([]);
  });
});

/** Testo piatto di un blocco, per asserire senza dipendere dai segmenti inline. */
function flatText(block: OutcomeBlock): string {
  if (block.kind === 'heading') return block.text;
  if (block.kind === 'text') return block.inline.map((s) => s.text).join('');
  if (block.kind === 'list') {
    return block.items.map((item) => item.map((s) => s.text).join('')).join('\n');
  }
  return block.sources.map((s) => `${s.title} ${s.url}`).join('\n');
}

describe('buildOutcomeBlocks', () => {
  it('sostituisce le righe delle Fonti con un blocco di link', () => {
    const md = `## Procedura\nprimo passo\n## Fonti\n- Titolo: ${A}`;
    const blocks = buildOutcomeBlocks(md);
    expect(blocks.map((b) => b.kind)).toEqual(['heading', 'text', 'heading', 'sources']);
    expect(blocks.map(flatText)).toEqual(['Procedura', 'primo passo', 'Fonti', `Titolo ${A}`]);
  });

  it('non stampa mai gli URL come testo', () => {
    const blocks = buildOutcomeBlocks(`## Fonti\n- Titolo: ${A}`);
    const asText = blocks
      .filter((b) => b.kind !== 'sources')
      .map(flatText)
      .join('\n');
    expect(asText).not.toContain(A);
  });

  it('riprende il testo normale dopo la sezione Fonti', () => {
    const md = `## Fonti\n- Titolo: ${A}\n## Note\nattenzione`;
    const blocks = buildOutcomeBlocks(md);
    expect(blocks.map((b) => b.kind)).toEqual(['heading', 'sources', 'heading', 'text']);
    expect(flatText(blocks[3])).toBe('attenzione');
  });

  it('tollera lo streaming: sezione Fonti ancora senza righe', () => {
    // Durante lo stream il markdown arriva a pezzi: l'intestazione può comparire
    // prima dei link. Nessun blocco `sources` vuoto, nessun crash.
    expect(buildOutcomeBlocks('## Fonti\n')).toEqual([{ kind: 'heading', text: 'Fonti' }]);
  });
});

describe('buildOutcomeBlocks · elenchi', () => {
  it('fonde righe puntate consecutive in un solo elenco', () => {
    const blocks = buildOutcomeBlocks('## Procedura\n- primo\n- secondo\n- terzo');
    expect(blocks.map((b) => b.kind)).toEqual(['heading', 'list']);
    const list = blocks[1];
    expect(list.kind === 'list' && list.ordered).toBe(false);
    expect(flatText(list)).toBe('primo\nsecondo\nterzo');
  });

  it('riconosce la numerazione come elenco ordinato', () => {
    const blocks = buildOutcomeBlocks('1. primo\n2) secondo');
    const list = blocks[0];
    expect(list.kind === 'list' && list.ordered).toBe(true);
    expect(flatText(list)).toBe('primo\nsecondo');
  });

  it('separa un elenco puntato da uno numerato', () => {
    const blocks = buildOutcomeBlocks('- a\n1. b');
    expect(blocks.map((b) => b.kind)).toEqual(['list', 'list']);
  });

  it('un paragrafo in mezzo chiude l’elenco', () => {
    const blocks = buildOutcomeBlocks('- a\ntesto\n- b');
    expect(blocks.map((b) => b.kind)).toEqual(['list', 'text', 'list']);
  });

  it('non confonde un trattino dentro il testo con un elenco', () => {
    const blocks = buildOutcomeBlocks('prezzo 10-20 euro');
    expect(blocks.map((b) => b.kind)).toEqual(['text']);
  });
});

describe('parseInline', () => {
  it('segmenta il grassetto markdown', () => {
    expect(parseInline('usa **PNR** e conferma')).toEqual([
      { text: 'usa ', bold: false },
      { text: 'PNR', bold: true },
      { text: ' e conferma', bold: false },
    ]);
  });

  it('gestisce più occorrenze e i bordi', () => {
    expect(parseInline('**a** e **b**')).toEqual([
      { text: 'a', bold: true },
      { text: ' e ', bold: false },
      { text: 'b', bold: true },
    ]);
  });

  it('lascia intatto il testo senza grassetto', () => {
    expect(parseInline('niente')).toEqual([{ text: 'niente', bold: false }]);
  });

  it('non tratta come grassetto un asterisco spaiato', () => {
    expect(parseInline('2 ** 3')).toEqual([{ text: '2 ** 3', bold: false }]);
  });
});
