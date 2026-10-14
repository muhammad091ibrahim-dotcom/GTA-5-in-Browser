// Network smoke test, not a gameplay test. Run with Node 24+ after deployment.
// Optional third argument is a DNS-verified IP for diagnosing local resolver failures.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const https = require('node:https');
const {Readable} = require('node:stream');
const {createHash} = require('node:crypto');
const origin = new URL(process.argv[2]).origin;
const ip = process.argv[3];
function networkFetch(input) {
  const url = new URL(input);
  assert.equal(url.origin, origin);
  return new Promise((resolve, reject) => {
    const options = ip ? {lookup: (_name, opts, cb) => opts.all ? cb(null, [{address: ip, family: 4}]) : cb(null, ip, 4)} : {};
    const req = https.get(url, options, res => resolve(new Response(Readable.toWeb(res), {status: res.statusCode, headers: res.headers})));
    req.setTimeout(60000, () => req.destroy(new Error('HTTPS request timed out')));
    req.on('error', reject);
  });
}
(async () => {
  const page = await networkFetch(origin + '/');
  assert.equal(page.status, 200);
  assert.equal(page.headers.get('Cross-Origin-Opener-Policy'), 'same-origin');
  assert.equal(page.headers.get('Cross-Origin-Embedder-Policy'), 'require-corp');
  const html = await page.text();
  assert.ok(html.includes('/chunk-fetch.js') && html.includes('Browser startup checks failed'));
  for (const path of ['/__support/', '/__support/check.js', '/__support/controller.js', '/__support/touch.js', '/help/']) {
    const response = await networkFetch(origin + path);
    assert.equal(response.status, 200, path);
    await response.body.cancel();
  }
  const manifestResponse = await networkFetch(origin + '/chunk-index.js');
  assert.equal(manifestResponse.status, 200);
  const manifest = JSON.parse((await manifestResponse.text()).replace(/^globalThis.GAME_CHUNKS=/, '').trim().replace(/;$/, ''));
  const codeResponse = await networkFetch(origin + '/chunk-fetch.js');
  const code = await codeResponse.text();
  assert.equal(code.replace(/\r\n/g, '\n'), fs.readFileSync('hosting/chunk-fetch.js', 'utf8').replace(/\r\n/g, '\n'));
  const context = vm.createContext({fetch: networkFetch, Request, Response, Headers, URL, ReadableStream, AbortController,
    location: {href: origin + '/', origin}, GAME_CHUNKS: manifest});
  vm.runInContext(code, context);
  const wasmPath = Object.keys(manifest.files).find(path => path.endsWith('/game.wasm'));
  const original = fs.readFileSync('mirror/playgta5.com' + wasmPath);
  const hash = bytes => createHash('sha256').update(bytes).digest('hex');
  for (const [start, end] of [[0, 3], [manifest.chunkSize - 37, manifest.chunkSize + 57], [original.length - 10, original.length - 1]]) {
    const response = await context.fetch(wasmPath, {headers: {Range: `bytes=${start}-${end}`}});
    assert.equal(response.status, 206);
    assert.deepEqual(Buffer.from(await response.arrayBuffer()), original.subarray(start, end + 1));
  }
  console.log('PASS: HTTPS isolation headers and real hosted cross-piece byte ranges');
  const bytes = Buffer.from(await (await context.fetch(wasmPath)).arrayBuffer());
  assert.equal(hash(bytes), hash(original));
  console.log('PASS: complete hosted engine SHA-256 matches the release (' + bytes.length + ' bytes)');
  await WebAssembly.compileStreaming(context.fetch(wasmPath));
  console.log('PASS: reconstructed hosted engine compiles with streaming WebAssembly');
  const dataFiles = Object.entries(manifest.files).filter(([path]) => path.startsWith('/data/'));
  const large = dataFiles.filter(([, entry]) => entry.prefix).sort((a, b) => b[1].size - a[1].size);
  for (const [path, entry] of [large[0], large[Math.floor(large.length / 2)], large[large.length - 1]]) {
    const handle = fs.openSync('mirror/playgta5.com' + path, 'r');
    try {
      const end = entry.size - 1, start = Math.max(0, end - 127);
      const expected = Buffer.alloc(end - start + 1);
      fs.readSync(handle, expected, 0, expected.length, start);
      const response = await context.fetch(path, {headers: {Range: `bytes=${start}-${end}`}});
      assert.equal(response.status, 206);
      assert.deepEqual(Buffer.from(await response.arrayBuffer()), expected, path);
    } finally { fs.closeSync(handle); }
  }
  const small = dataFiles.filter(([, entry]) => entry.url && entry.size > 0).sort((a, b) => a[1].size - b[1].size)[0];
  const response = await context.fetch(small[0]);
  assert.equal(response.status, 200);
  assert.deepEqual(Buffer.from(await response.arrayBuffer()), fs.readFileSync('mirror/playgta5.com' + small[0]));
  console.log('PASS: three real game-data archives and one unchunked asset match the release');
  const buildFolder = fs.readdirSync('mirror/playgta5.com/b')[0];
  for (const worker of ['loader.js', 'io_worker.js']) {
    const response = await networkFetch(origin + '/b/' + buildFolder + '/' + worker);
    assert.equal(response.status, 200);
    assert.ok((await response.text()).startsWith("importScripts('/chunk-index.js', '/chunk-fetch.js');"));
  }
  console.log('PASS: game workers include the hosted asset adapter; help and diagnostics are reachable');
  const missing = await networkFetch(origin + '/missing-test-asset-not-in-release.bin');
  assert.equal(missing.status, 404); await missing.body.cancel();
  console.log('PASS: missing assets return 404 instead of the game HTML');
})().catch(error => { console.error(error); process.exitCode = 1; });
