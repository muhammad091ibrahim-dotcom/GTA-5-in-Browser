const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const http = require('node:http');
const {once} = require('node:events');

(async () => {
  // Exercise the browser adapter against real HTTP, including hosts ignoring Range.
  const data = Buffer.from(Array.from({length: 29}, (_, n) => n));
  const wasm = Buffer.from([0, 97, 115, 109, 1, 0, 0, 0]);
  let ignoreRange = false, truncate = false, failStatus = 0;
  const calls = [];
  const server = http.createServer((req, res) => {
    calls.push({url: req.url, range: req.headers.range});
    if (failStatus) { res.writeHead(failStatus); res.end('unavailable'); return; }
    const match = /^\/(pieces|wasm)\/(\d+)\.bin$/.exec(req.url);
    if (!match) { res.end('ordinary asset'); return; }
    const source = match[1] === 'wasm' ? wasm : data;
    const bytes = source.subarray(Number(match[2]) * 8, Number(match[2]) * 8 + 8);
    const range = /bytes=(\d+)-(\d+)/.exec(req.headers.range || '');
    if (range && !ignoreRange) {
      const a = +range[1], b = +range[2];
      res.writeHead(206, {'Content-Range': `bytes ${a}-${b}/${bytes.length}`});
      res.end(bytes.subarray(a, truncate ? b : b + 1));
    } else res.end(truncate ? bytes.subarray(0, bytes.length - 1) : bytes);
  });
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  const origin = `http://127.0.0.1:${server.address().port}`;
  function makeFetch() {
    const context = vm.createContext({fetch, Request, Response, Headers, URL, ReadableStream, AbortController,
    location: {href: origin + '/b/test/loader.js', origin},
    GAME_CHUNKS: {chunkSize: 8, files: {
      '/data/game.rpf': {size: data.length, prefix: '/pieces', type: 'application/octet-stream'},
      '/b/test/game.wasm': {size: wasm.length, prefix: '/wasm', type: 'application/wasm'}
    }}});
    vm.runInContext(fs.readFileSync('hosting/chunk-fetch.js', 'utf8'), context);
    return context.fetch;
  }
  let fetchGame = makeFetch();
  try {
    for (ignoreRange of [false, true]) {
      fetchGame = makeFetch();
      for (const [range, a, b] of [[null, 0, 28], ['bytes=0-3', 0, 3], ['bytes=6-18', 6, 18], ['bytes=28-999', 28, 28], ['bytes=7-', 7, 28], ['bytes=-4', 25, 28]]) {
        const res = await fetchGame('/data/game.rpf?v=verified', {headers: range ? {Range: range} : {}});
        assert.equal(res.status, range ? 206 : 200);
        assert.equal(+res.headers.get('Content-Length'), b - a + 1);
        assert.deepEqual(Buffer.from(await res.arrayBuffer()), data.subarray(a, b + 1));
      }
    }
    ignoreRange = false;
    const request = new Request(origin + '/data/game.rpf', {headers: {Range: 'bytes=8-9'}});
    assert.deepEqual(Buffer.from(await (await fetchGame(request)).arrayBuffer()), data.subarray(8, 10));
    for (const range of ['bytes=29-', 'bytes=-0', 'bytes=5-2', 'bytes=1-2,4-5', 'broken']) {
      assert.equal((await fetchGame('/data/game.rpf', {headers: {Range: range}})).status, 416);
    }
    const head = await fetchGame('/data/game.rpf', {method: 'HEAD'});
    assert.equal(head.body, null); assert.equal(+head.headers.get('Content-Length'), 29);
    assert.equal(await (await fetchGame(origin + '/other.txt')).text(), 'ordinary asset');
    const compiled = await WebAssembly.compileStreaming(fetchGame('/b/test/game.wasm'));
    assert.ok(compiled instanceof WebAssembly.Module);
    fetchGame = makeFetch();
    const sharedStart = calls.length;
    await Promise.all([0, 1, 2].map(async n => {
      const res = await fetchGame('/data/game.rpf', {headers: {Range: `bytes=${n}-${n}`}});
      assert.deepEqual(Buffer.from(await res.arrayBuffer()), data.subarray(n, n + 1));
    }));
    assert.equal(calls.length, sharedStart + 1, 'Concurrent reads must share one whole-piece download');
    assert.equal(calls.at(-1).range, undefined, 'Transport must work without server Range support');
    fetchGame = makeFetch();
    const before = calls.length;
    const cancelResponse = await fetchGame('/data/game.rpf');
    await cancelResponse.body.cancel();
    assert.equal(calls.length, before + 1, 'Cancellation must not download later pieces');
    const abort = new AbortController(); abort.abort();
    await assert.rejects(fetchGame('/data/game.rpf', {signal: abort.signal}));
    fetchGame = makeFetch(); failStatus = 503;
    const failed = await fetchGame('/data/game.rpf');
    assert.equal(failed.status, 503); failStatus = 0;
    fetchGame = makeFetch(); truncate = true;
    await assert.rejects(async () => (await fetchGame('/data/game.rpf')).arrayBuffer(), /Truncated/);
    console.log('PASS: full/ranged/cross-piece reads, suffixes, static caching, shared requests, HEAD, WASM streaming, cancellation, abort and corrupt/error responses');
  } finally { server.closeAllConnections(); server.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
