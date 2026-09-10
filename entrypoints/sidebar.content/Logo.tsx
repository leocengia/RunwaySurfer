// Wrapper React del marchio condiviso.
//
// Il marchio arriva come data-URI da shared/logo-mark.ts, generato da
// docs/build-icons.mjs a partire da shared/logo_v2_alpha.png. Un data-URI e non un
// asset emesso dal bundler: la stessa costante serve anche al banner del tour, che
// costruisce markup nel DOM della pagina host, e così non serve dichiarare
// web_accessible_resources né fare una richiesta in più.
import { LOGO_MARK } from '../../shared/logo-mark';

export function Logo({ size = 24 }: { size?: number }) {
  return (
    <img
      className="rs-logo"
      src={LOGO_MARK}
      width={size}
      height={size}
      alt=""
      aria-hidden="true"
      draggable={false}
    />
  );
}
