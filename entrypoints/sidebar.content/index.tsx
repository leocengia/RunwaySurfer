// Content script that injects the RunwaySurfer sidebar into the KB page.
// Uses a Shadow DOM (via WXT's createShadowRootUi) so the extension's styles
// never clash with the host page's CSS.
import ReactDOM from 'react-dom/client';
import App from './App';
import './style.css';

export default defineContentScript({
  matches: ['*://*.wikipedia.org/*'],
  cssInjectionMode: 'ui',
  async main(ctx) {
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
