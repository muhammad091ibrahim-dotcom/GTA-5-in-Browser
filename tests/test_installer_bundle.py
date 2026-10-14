import hashlib
from pathlib import Path
import tempfile
import unittest
import zipfile

from build_installer import build, FILES, HERE


class InstallerBundleTests(unittest.TestCase):
    def test_bundle_contains_current_helpers_without_game_or_credentials(self):
        with tempfile.TemporaryDirectory() as directory:
            output = Path(directory) / 'installer.zip'
            build(output)
            with zipfile.ZipFile(output) as archive:
                self.assertIsNone(archive.testzip())
                self.assertEqual(set(archive.namelist()), {'PlayGTA5/' + name for name in FILES})
                for name in FILES:
                    self.assertEqual(archive.read('PlayGTA5/' + name), (HERE / name).read_bytes())
                self.assertTrue(archive.getinfo('PlayGTA5/Launch-Local.command').external_attr >> 16 & 0o111)
            self.assertEqual(output.with_suffix('.zip.sha256').read_text().split()[0], hashlib.sha256(output.read_bytes()).hexdigest())


if __name__ == '__main__':
    unittest.main()
