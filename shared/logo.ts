// Marchio Runway Surfer per il lato estensione.
//
// Il glifo vive in shared/logo.svg (unica fonte, letta anche dal server) e qui
// entra come stringa: serve sia a React (sidebar) sia a codice che costruisce
// markup a mano nel DOM della pagina host (banner del tour), quindi una stringa
// è il minimo comune denominatore. Il contenitore decide la dimensione, l'SVG
// scala a 100%.
import logoRaw from './logo.svg?raw';

export const LOGO_SVG: string = logoRaw;
