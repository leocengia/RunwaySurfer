// Content script that injects the RunwaySurfer sidebar into the KB page.
// Uses a Shadow DOM (via WXT's createShadowRootUi) so the extension's styles
// never clash with the host page's CSS.
import ReactDOM from 'react-dom/client';
import App from './App';
import './style.css';

export default defineContentScript({
  // KB reale (Salesforce Experience Cloud) + Wikipedia per il demo/dev.
  matches: ['https://traveler.my.site.com/Runway/*', '*://*.wikipedia.org/*'],
  cssInjectionMode: 'ui',
  async main(ctx) {
    // Monta SOLO nel top frame. B2 (`lib/nav.ts openAndReadArticle`) legge gli
    // articoli solo-indice in un IFRAME nascosto di una pagina KB: quell'iframe
    // combacia con `matches`, quindi senza questa guardia il content-script si
    // rimonterebbe dentro l'iframe (sidebar/boot Aura duplicati, root React
    // annidati). Di default MV3 usa all_frames:false, ma la guardia lo rende certo.
    if (window.top !== window.self) return;
    const ui = await createShadowRootUi(ctx, {
      name: 'runwaysurfer-sidebar',
      position: 'overlay',
      anchor: 'body',
      onMount(container) {
        const root = ReactDOM.createRoot(container);
        root.render(<App />);
        return root;
      },
      onRemove(root) {
        root?.unmount();
      },
    });
    ui.mount();
  },
});
