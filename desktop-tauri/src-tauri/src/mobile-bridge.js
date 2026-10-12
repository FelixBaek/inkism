// Android custom-protocol requests are not relied on for POST bodies. All API
// fetches use Tauri IPC; static assets/images retain the custom protocol.
(() => {
  const originalFetch = window.fetch.bind(window);
  const MAX_BODY = 64 * 1024 * 1024;
  Object.defineProperty(window, '__INKISM_MOBILE__', { value: true });
  window.fetch = async (input, init) => {
    const request = new Request(input instanceof Request ? input : new URL(String(input), location.href), init);
    const url = new URL(request.url);
    if (url.protocol !== location.protocol || url.host !== location.host || !url.pathname.startsWith('/api/'))
      return originalFetch(input, init);
    if (request.signal.aborted) throw new DOMException('The operation was aborted.', 'AbortError');
    const buffer = await request.arrayBuffer();
    if (buffer.byteLength > MAX_BODY) throw new Error('모바일 파일 전송은 64MB까지 지원합니다.');
    const invoke = window.__TAURI__?.core?.invoke;
    if (!invoke) throw new Error('앱 저장 엔진을 연결하지 못했습니다.');
    // Mutations that entered Rust are deliberately awaited even if the page
    // later aborts its fetch; a committed save must report its real revision.
    const result = await invoke('mobile_api', { request: {
      method: request.method,
      path: url.pathname,
      query: url.search ? url.search.slice(1) : null,
      headers: Array.from(request.headers.entries()),
      body: Array.from(new Uint8Array(buffer)),
    }});
    return new Response(request.method === 'HEAD' || result.status === 204 || result.status === 304 ? null : new Uint8Array(result.body), { status: result.status, headers: result.headers });
  };
})();
