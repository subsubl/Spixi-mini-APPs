"""Reproducible experimental branch package, standard-library only."""
from pathlib import Path
import hashlib
import io
import zipfile

root = Path(__file__).resolve().parents[1]
name = 'com.baracuda.spixi.protocol-eclipse'
base = ('https://raw.githubusercontent.com/subsubl/Spixi-mini-APPs/'
        'feat/eclipse-packet-voice-receive/apps/' + name + '/dist/')
files = [root / 'appinfo.spixi', root / 'icon.png'] + sorted(
    p for p in (root / 'app').rglob('*') if p.is_file())
output = io.BytesIO()
with zipfile.ZipFile(output, 'w', compression=zipfile.ZIP_DEFLATED) as archive:
    for path in files:
        info = zipfile.ZipInfo(path.relative_to(root).as_posix(), (2026, 1, 1, 0, 0, 0))
        info.compress_type = zipfile.ZIP_DEFLATED
        info.external_attr = 0o644 << 16
        archive.writestr(info, path.read_bytes())
data = output.getvalue()
sha = hashlib.sha256(data).hexdigest()
dist = root / 'dist'
dist.mkdir(exist_ok=True)
(dist / (name + '.zspixiapp')).write_bytes(data)
(dist / (name + '.png')).write_bytes((root / 'icon.png').read_bytes())
metadata = ((root / 'appinfo.spixi').read_text().strip() + '\n'
            + f'image = {base}{name}.png\ncontentUrl = {base}{name}.zspixiapp\n'
            + f'checksum = {sha}\ncontentSize = {len(data)}\n')
for filename in ['install-test.spixi', name + '.spixi']:
    (dist / filename).write_text(metadata)
with zipfile.ZipFile(io.BytesIO(data)) as archive:
    assert archive.testzip() is None
    for path in files:
        assert archive.read(path.relative_to(root).as_posix()) == path.read_bytes()
print(f'PASS package: {len(data)} bytes, {len(files)} files, SHA256 {sha}')
print('Native installation NOT tested; URLs require pushing this branch.')
