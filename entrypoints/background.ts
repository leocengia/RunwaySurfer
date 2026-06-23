// Background service worker.
//
// In the demo the sidebar (content script) talks to the backend proxy directly
// via streaming fetch — the proxy returns CORS headers, so no host permission
// is needed. The background is kept minimal here.
//
// PRODUCTION OPTION: route the proxy call through the background instead (e.g.
// to centralize auth headers or per-agent identity), bridging the SSE stream to
// the sidebar over a chrome.runtime Port. The message contracts for that path
// live in lib/messaging.ts.
export default defineBackground(() => {
  // No-op for the demo. Lifecycle hooks can go here later.
});
