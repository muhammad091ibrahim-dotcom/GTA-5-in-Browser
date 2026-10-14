/* Serve byte ranges from small immutable static files. Pages may ignore Range.
 * Whole pieces use the browser HTTP cache; bounded RAM and shared pending
 * requests avoid downloading the same piece for concurrent engine reads.
 */
(() => {
  'use strict';
  const originalFetch = globalThis.fetch.bind(globalThis);
  const manifest = globalThis.GAME_CHUNKS;
  const cache = new Map(), pending = new Map(), budget = 32 * 1024 * 1024;
  let cacheBytes = 0;
  async function piece(url, size, options) {
    const key = url.href;
    if (cache.has(key)) {
      const bytes = cache.get(key); cache.delete(key); cache.set(key, bytes);
      return {bytes};
    }
    if (pending.has(key)) return pending.get(key);
    const job = (async () => {
      // At most 4 MiB per transfer. A reader must not abort another reader's shared transfer.
      const res = await originalFetch(url, {cache: 'force-cache', priority: options.priority});
      if (!res.ok) { await res.body?.cancel(); return {failure: {status: res.status, statusText: res.statusText}}; }
      if (res.status !== 200) { await res.body?.cancel(); throw new Error(`Unexpected chunk status ${res.status}`); }
      const bytes = new Uint8Array(await res.arrayBuffer());
      if (bytes.length !== size) throw new Error(`Truncated or invalid game chunk: expected ${size}, received ${bytes.length}`);
      while (cacheBytes + bytes.length > budget && cache.size) {
        const oldest = cache.keys().next().value;
        cacheBytes -= cache.get(oldest).byteLength; cache.delete(oldest);
      }
      if (bytes.length <= budget) { cache.set(key, bytes); cacheBytes += bytes.length; }
      return {bytes};
    })();
    pending.set(key, job);
    try { return await job; } finally { pending.delete(key); }
  }
  function waitForPiece(job, signal) {
    signal.throwIfAborted();
    return new Promise((resolve, reject) => {
      const abort = () => reject(signal.reason);
      signal.addEventListener('abort', abort, {once: true});
      job.then(resolve, reject).finally(() => signal.removeEventListener('abort', abort));
    });
  }
  globalThis.fetch = async (input, options = {}) => {
    const request = new Request(input instanceof Request ? input : new URL(input, location.href), options);
    const url = new URL(request.url);
    const file = url.origin === location.origin && manifest.files[decodeURI(url.pathname)];
    if (!file || !['GET', 'HEAD'].includes(request.method)) return originalFetch(input, options);
    request.signal.throwIfAborted();
    const size = file.size, step = file.url ? size : manifest.chunkSize;
    let start = 0, end = size - 1;
    const range = request.headers.get('Range');
    if (range) {
      const match = /^bytes=(\d*)-(\d*)$/.exec(range);
      if (!match || (!match[1] && !match[2])) return new Response(null, {status: 416, headers: {'Content-Range': `bytes */${size}`}});
      if (!match[1]) start = Math.max(0, size - Number(match[2]));
      else { start = Number(match[1]); if (match[2]) end = Math.min(end, Number(match[2])); }
      if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start > end || start >= size) {
        return new Response(null, {status: 416, headers: {'Content-Range': `bytes */${size}`}});
      }
    }
    const headers = new Headers({'Content-Type': file.type, 'Content-Length': String(end - start + 1), 'Accept-Ranges': 'bytes'});
    if (range) headers.set('Content-Range', `bytes ${start}-${end}/${size}`);
    const responseInit = {status: range ? 206 : 200, headers};
    if (request.method === 'HEAD' || !size) return new Response(null, responseInit);
    let position = start, cancelled = false;
    const controller = new AbortController();
    const onAbort = () => controller.abort(request.signal.reason);
    request.signal.addEventListener('abort', onAbort, {once: true});
    const cleanup = () => request.signal.removeEventListener('abort', onAbort);
    async function next() {
      controller.signal.throwIfAborted();
      const index = Math.floor(position / step);
      const pieceURL = new URL(file.url ? file.url + url.search : `${file.prefix}/${String(index).padStart(4, '0')}.bin`, location.origin);
      return waitForPiece(piece(pieceURL, Math.min(step, size - index * step), options), controller.signal);
    }
    let ready;
    try { ready = await next(); if (ready.failure) { cleanup(); return new Response(null, ready.failure); } }
    catch (error) { cleanup(); throw error; }
    return new Response(new ReadableStream({
      async pull(stream) {
        try {
          const result = ready || await next(); ready = null;
          if (cancelled) return;
          controller.signal.throwIfAborted();
          if (result.failure) throw new Error(`Chunk HTTP ${result.failure.status}`);
          const offset = position % step;
          const bytes = result.bytes.subarray(offset, Math.min(result.bytes.length, offset + end - position + 1));
          position += bytes.length;
          stream.enqueue(bytes);
          if (position > end) { cleanup(); stream.close(); }
        } catch (error) { cleanup(); if (!cancelled) stream.error(error); }
      },
      cancel(reason) { cancelled = true; cleanup(); controller.abort(reason); }
    }, {highWaterMark: 0}), responseInit);
  };
})();
