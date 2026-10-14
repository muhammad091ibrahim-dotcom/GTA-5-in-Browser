"""Build the small Windows/Mac installer bundle; the 21 GB game is downloaded later."""
import argparse
import hashlib
from pathlib import Path
import zipfile

HERE = Path(__file__).resolve().parent
FILES = (
    'Download-Game.cmd', 'Download-Game.ps1', 'Download-Game.command',
    'Launch-Local.cmd', 'Start-Local.ps1', 'Launch-Local.command',
    'Verify-Game.cmd', 'Verify-Game.command', 'mac-launcher.sh',
    'download_game.py', 'serve_local.py', 'verify_game.py',
    'download-manifest.json', 'file-inventory.json', 'SHA256SUMS.txt',
    'README.md', 'ENGINE-LIMITATIONS.md', 'support/index.html', 'support/check.js', 'support/overlay.html', 'support/controller.js', 'support/touch.js',
)


def build(output):
    output.parent.mkdir(parents=True, exist_ok=True)
    with zipfile.ZipFile(output, 'w', compression=zipfile.ZIP_DEFLATED, compresslevel=9) as archive:
        for name in FILES:
            entry = zipfile.ZipInfo('PlayGTA5/' + name)
            entry.create_system = 3
            entry.external_attr = (0o100755 if name.endswith(('.command', '.sh')) else 0o100644) << 16
            entry.compress_type = zipfile.ZIP_DEFLATED
            archive.writestr(entry, (HERE / name).read_bytes())
    checksum = hashlib.sha256(output.read_bytes()).hexdigest()
    output.with_suffix(output.suffix + '.sha256').write_text(f'{checksum}  {output.name}\n', encoding='utf-8')
    print(f'Installer ready: {output} ({output.stat().st_size:,} bytes); SHA-256 {checksum}')


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--output', type=Path, default=HERE / 'release-output/PlayGTA5-Installer.zip')
    build(parser.parse_args().output)
