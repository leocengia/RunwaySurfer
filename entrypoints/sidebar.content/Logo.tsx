// Wrapper React del marchio condiviso (shared/logo.svg).
//
// Il glifo vive come stringa perché serve anche al banner del tour, che
// costruisce markup nel DOM della pagina host fuori da React. Una sola
// definizione, tre punti di montaggio (header, launcher, banner).
import { LOGO_SVG } from '../../shared/logo';

export function Logo({ size = 20 }: { size?: number }) {
  return (
    <span
      className="rs-logo"
      style={{ width: size, height: size }}
      aria-hidden="true"
      // Costante nostra, nessun input esterno la raggiunge.
      dangerouslySetInnerHTML={{ __html: LOGO_SVG }}
    />
  );
}
