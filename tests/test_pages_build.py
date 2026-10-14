import hashlib
from pathlib import Path
import subprocess
import tempfile
import unittest

from build_pages import package_file, patch_startup, PREFLIGHT
from build_web import PREFIX


class PagesBuildTests(unittest.TestCase):
    def test_split_assets_reconstruct_and_source_stays_unchanged(self):
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            original = root / 'source.wasm'
            data = bytes(range(29))
            original.write_bytes(data)
            record = {'path': PREFIX + 'b/test/game.wasm', 'bytes': len(data), 'sha256': hashlib.sha256(data).hexdigest()}
            chunks = {}
            package_file(original, root / 'output', record, chunks, chunk_size=8, file_limit=10)
            info = chunks['/b/test/game.wasm']
            parts = sorted((root / 'output' / info['prefix'].lstrip('/')).glob('*.bin'))
            self.assertEqual([p.stat().st_size for p in parts], [8, 8, 8, 5])
            self.assertEqual(b''.join(p.read_bytes() for p in parts), data)
            self.assertEqual(original.read_bytes(), data)
            self.assertEqual(info['type'], 'application/wasm')
            record['sha256'] = '0' * 64
            with self.assertRaisesRegex(ValueError, 'Source verification'):
                package_file(original, root / 'bad', record, {})

    def test_javascript_range_transport_over_http(self):
        subprocess.run(['node', 'tests/test_chunk_fetch.cjs'], check=True, timeout=30)

    def test_hosted_startup_routes_missing_features_to_help(self):
        for feature in ['ok', 'gpu', 'memory64', 'isolation', 'context', 'bc']:
            setup = f"""
const assert=require('node:assert/strict'), failure={feature!r};
let redirected=false;
const reasons={{gpu:'gpu-adapter',memory64:'memory64',isolation:'shared-memory',context:'secure-context',bc:'texture-compression-bc'}};
const location={{replace(path){{assert.equal(path,'/__support/?startup='+reasons[failure]); redirected=true;}}}};
const isSecureContext=failure!=='context', crossOriginIsolated=failure!=='isolation';
const OffscreenCanvas=function(){{}}, WebAssembly={{validate:()=>failure!=='memory64'}};
const navigator={{gpu:{{requestAdapter:async()=>failure==='gpu'?null:{{features:new Set(failure==='bc'?[]:['texture-compression-bc'])}}}}}};
(async()=>{{try {{ {PREFLIGHT} }} catch(e) {{if(failure==='ok')throw e;}}
assert.equal(redirected, failure!=='ok');}})().catch(e=>{{console.error(e);process.exitCode=1;}});
"""
            subprocess.run(['node', '-e', setup], check=True, timeout=10)
        self.assertIn(PREFLIGHT, patch_startup('<head></head><script type="module">start();</script>'))
        with self.assertRaises(ValueError):
            patch_startup('unknown page')


if __name__ == '__main__':
    unittest.main()
