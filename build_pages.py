"""Package a verified game mirror as Cloudflare Pages static assets (no paid storage)."""
import argparse
import hashlib
import json
import mimetypes
import os
from pathlib import Path
import shutil

from build_web import HERE, PREFIX, finish
from download_game import digest, target_path

CHUNK_SIZE = 4 * 1024**2
FILE_LIMIT = 25 * 1024**2

PREFLIGHT = """
// Explain unavailable browser capabilities before downloading/starting the engine.
let startupAdapter = null;
let startupFailure = !isSecureContext ? 'secure-context'
  : !crossOriginIsolated || typeof SharedArrayBuffer === 'undefined' ? 'shared-memory'
  : typeof OffscreenCanvas === 'undefined' ? 'offscreen-canvas'
  : typeof WebAssembly === 'undefined' || !WebAssembly.validate(new Uint8Array([0,97,115,109,1,0,0,0,5,4,1,7,0,1])) ? 'memory64'
  : !navigator.gpu ? 'webgpu' : '';
if (isSecureContext && crossOriginIsolated && typeof SharedArrayBuffer !== 'undefined'
    && typeof OffscreenCanvas !== 'undefined' && typeof WebAssembly !== 'undefined'
    && WebAssembly.validate(new Uint8Array([0,97,115,109,1,0,0,0,5,4,1,7,0,1])) && navigator.gpu) {
  try { startupAdapter = await navigator.gpu.requestAdapter({powerPreference:'high-performance'}); } catch {}
}
if (startupAdapter && !startupAdapter.features.has('texture-compression-bc')) startupFailure = 'texture-compression-bc';
if (!startupAdapter || startupFailure) {
  location.replace('/__support/?startup=' + (startupFailure || 'gpu-adapter'));
  throw new Error('Browser startup checks failed; see the compatibility page.');
}
startupAdapter = null;
"""


def patch_startup(code):
    marker = '<script type="module">'
    if code.count(marker) != 1 or code.count('<head>') != 1:
        raise ValueError('Unrecognized game page: expected one module and head')
    code = code.replace('<head>', '<head>\n<script src="/chunk-index.js"></script><script src="/chunk-fetch.js"></script>', 1)
    return code.replace(marker, marker + '\n' + PREFLIGHT, 1)


def package_file(original, destination, record, chunks, chunk_size=CHUNK_SIZE, file_limit=CHUNK_SIZE):
    if original.stat().st_size != record['bytes'] or digest(original) != record['sha256']:
        raise ValueError(f'Source verification failed: {record["path"]}')
    relative = record['path'][len(PREFIX):]
    if record['bytes'] > file_limit:
        prefix = f'/__chunks/{record["sha256"]}'
        folder = target_path(destination, prefix.lstrip('/'))
        folder.mkdir(parents=True, exist_ok=True)
        combined = hashlib.sha256()
        with original.open('rb') as stream:
            index = 0
            while data := stream.read(chunk_size):
                part = folder / f'{index:04}.bin'
                part.write_bytes(data)
                combined.update(part.read_bytes())
                index += 1
        if combined.hexdigest() != record['sha256']:
            raise ValueError(f'Chunk verification failed: {relative}')
        chunks['/' + relative] = {'size': record['bytes'], 'prefix': prefix,
                                 'type': mimetypes.guess_type(relative)[0] or 'application/octet-stream'}
    else:
        output = target_path(destination, relative)
        output.parent.mkdir(parents=True, exist_ok=True)
        # Only immutable assets share disk space with the downloaded release.
        if original.suffix in {'.js', '.html'}:
            shutil.copyfile(original, output)
        else:
            try:
                os.link(original, output)
            except OSError:
                shutil.copyfile(original, output)
        if relative.startswith('data/'):
            chunks['/' + relative] = {'size': record['bytes'], 'url': '/' + relative,
                                     'type': mimetypes.guess_type(relative)[0] or 'application/octet-stream'}


def build(source, output):
    if output.exists():
        raise ValueError(f'Choose a fresh output directory: {output}')
    inventory = json.loads((HERE / 'file-inventory.json').read_text(encoding='utf-8'))
    records = [r for r in inventory['files'] if r['path'].startswith(PREFIX)]
    extra = sum(r['bytes'] for r in records if r['bytes'] > CHUNK_SIZE)
    if shutil.disk_usage(output.parent).free < extra + 512 * 1024**2:
        raise ValueError('Insufficient disk space for chunked assets')
    output.mkdir()
    chunks = {}
    for index, record in enumerate(records):
        original = target_path(source, record['path'][len(PREFIX):])
        package_file(original, output, record, chunks)
        if index % 500 == 0:
            print(f'Verified and packaged {index + 1}/{len(records)} files', flush=True)
    finish(output)
    page = output / 'index.html'
    page.write_text(patch_startup(page.read_text(encoding='utf-8')), encoding='utf-8')
    manifest = {'chunkSize': CHUNK_SIZE, 'files': chunks}
    (output / 'chunk-index.js').write_text('globalThis.GAME_CHUNKS=' + json.dumps(manifest, separators=(',', ':')) + ';\n', encoding='utf-8')
    shutil.copyfile(HERE / 'hosting/chunk-fetch.js', output / 'chunk-fetch.js')
    for name in ['loader.js', 'io_worker.js']:
        workers = list((output / 'b').glob('*/' + name))
        if len(workers) != 1:
            raise ValueError(f'Expected exactly one {name}')
        worker = workers[0]
        worker.write_text("importScripts('/chunk-index.js', '/chunk-fetch.js');\n" + worker.read_text(encoding='utf-8'), encoding='utf-8')
    shutil.copytree(HERE / 'support', output / '__support', dirs_exist_ok=True)
    support = output / '__support/index.html'
    support.write_text(support.read_text(encoding='utf-8').replace('<script src="/__support/check.js">', '<script src="/chunk-index.js"></script><script src="/chunk-fetch.js"></script><script src="/__support/check.js">'), encoding='utf-8')
    (output / '_headers').write_text('/*\n  Cross-Origin-Opener-Policy: same-origin\n  Cross-Origin-Embedder-Policy: require-corp\n  Cross-Origin-Resource-Policy: same-origin\n/__chunks/*\n  Cache-Control: public, max-age=31536000, immutable\n', encoding='utf-8')
    # Prevent Pages' implicit SPA fallback from returning HTML for missing data.
    (output / '404.html').write_text('<!doctype html><title>Not found</title><h1>File not found</h1><a href="/__support/">Check browser and loading</a>', encoding='utf-8')
    files = [p for p in output.rglob('*') if p.is_file()]
    if len(files) > 20000 or any(p.stat().st_size > FILE_LIMIT for p in files):
        raise ValueError('Output exceeds Cloudflare Pages Free static asset limits')
    print(f'Ready: {len(files)} static files; {sum("prefix" in f for f in chunks.values())} large assets split into verified 4 MiB pieces.', flush=True)


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--source', type=Path, default=HERE / 'mirror/playgta5.com')
    parser.add_argument('--output', type=Path, default=HERE / 'pages-output')
    args = parser.parse_args()
    build(args.source.resolve(), args.output.resolve())
