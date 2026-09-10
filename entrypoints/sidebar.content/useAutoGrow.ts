// Textarea che si adatta al contenuto.
//
// Prima il box del prompt aveva `min-height: 84px` fisso (e `rows={3}` era codice
// morto, perché il min-height vinceva sempre): una domanda di due parole occupava
// lo stesso spazio di un paragrafo, e una lunga andava in scroll interno invece
// di crescere. Qui l'altezza segue il contenuto fino a un tetto.
import { useEffect, type RefObject } from 'react';

/**
 * Adatta l'altezza dell'elemento al suo contenuto a ogni cambio di `value`.
 *
 * `height = 'auto'` prima della lettura è necessario: `scrollHeight` include
 * l'altezza già imposta, quindi senza azzerarla il box potrebbe solo crescere e
 * mai rimpicciolirsi quando si cancella del testo.
 */
export function useAutoGrow(
  ref: RefObject<HTMLTextAreaElement | null>,
  value: string,
  maxPx = 200,
): void {
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, maxPx)}px`;
    // Oltre il tetto lo scroll interno serve; sotto, una barra vuota è rumore.
    el.style.overflowY = el.scrollHeight > maxPx ? 'auto' : 'hidden';
  }, [ref, value, maxPx]);
}
