#!/usr/bin/env python3
"""Create a reproducible, unsigned runtime-only extension ZIP with stdlib only."""
import argparse
import hashlib
from html.parser import HTMLParser
import json
from pathlib import Path
import re
import zipfile

ROOT = Path(__file__).resolve().parents[1]
RUNTIME = (
    'manifest.json', 'build.js', 'core.js', 'notifications.js', 'state.js',
    'background.js', 'extractor.js', 'content.js', 'popup.html', 'popup.js',
    'dashboard.html', 'dashboard.js', 'style.css',
)


class References(HTMLParser):
    def __init__(self):
        super().__init__()
        self.files = []

    def handle_starttag(self, tag, attrs):
        attrs = dict(attrs)
        if tag == 'script' and attrs.get('src'):
            self.files.append(attrs['src'])
        if tag == 'link' and attrs.get('rel') == 'stylesheet' and attrs.get('href'):
            self.files.append(attrs['href'])


def sources(root):
    result = {}
    for name in RUNTIME:
        path = root / name
        if path.is_symlink() or not path.is_file():
            raise ValueError(f'Missing or symlinked runtime asset: {name}')
        result[name] = path.read_bytes()
    manifest = json.loads(result['manifest.json'])
    stamp = re.search(r'const build=Object\.freeze\((\{[^\n]+\})\);', result['build.js'].decode())
    if not stamp:
        raise ValueError('build.js must contain one literal JSON build stamp')
    metadata = json.loads(stamp.group(1))
    if set(metadata) != {'version', 'id', 'protocol'}:
        raise ValueError('Unexpected build metadata fields')
    if metadata.get('version') != manifest.get('version') or not re.fullmatch(r'\d+\.\d+\.\d+', manifest['version']):
        raise ValueError('Manifest and build version must match')
    if type(metadata.get('protocol')) is not int or metadata['protocol'] < 1:
        raise ValueError('Invalid build protocol')
    refs = manifest['background']['scripts'] + [v for group in manifest['content_scripts'] for v in group['js']]
    refs += [manifest['browser_action']['default_popup'], manifest['options_ui']['page']]
    for name in ['popup.html', 'dashboard.html']:
        parser = References()
        parser.feed(result[name].decode())
        refs += parser.files
    if any(name not in RUNTIME for name in refs):
        raise ValueError('Manifest or HTML references an asset outside the reviewed runtime allowlist')
    if manifest['background']['scripts'][0] != 'build.js' or any(group['js'][0] != 'build.js' for group in manifest['content_scripts']):
        raise ValueError('Build metadata must precede stamped scripts')
    for name, body in result.items():
        if re.search(rb'https://discord\.com/api/webhooks/\d+/[A-Za-z0-9_-]+', body) or b'-----BEGIN PRIVATE KEY-----' in body:
            raise ValueError(f'Possible embedded secret in runtime asset: {name}')
    return result, metadata


def package(root, destination):
    assets, metadata = sources(root)
    digest = hashlib.sha256()
    for name in sorted(assets):
        if name != 'build.js':
            digest.update(name.encode() + b'\0' + assets[name] + b'\0')
    digest.update(str(metadata['protocol']).encode())
    stamp = {**metadata, 'id': f"{metadata['version']}-{digest.hexdigest()[:20]}"}
    assets['build.js'] = (
        '// Generated release stamp; derived from reviewed runtime assets.\n'
        '(() => {\n  const build=Object.freeze(' + json.dumps(stamp, separators=(',', ':')) + ');\n'
        '  globalThis.ClassroomBuild=build;\n'
        "  if(typeof module!=='undefined')module.exports=build;\n})();\n"
    ).encode()
    destination.parent.mkdir(parents=True, exist_ok=True)
    # Exclusive creation: never overwrite a user's existing release artifact.
    with destination.open('xb') as stream:
        with zipfile.ZipFile(stream, 'w', compression=zipfile.ZIP_DEFLATED, compresslevel=9) as archive:
            for name in sorted(assets):
                entry = zipfile.ZipInfo(name, date_time=(2026, 1, 1, 0, 0, 0))
                entry.compress_type = zipfile.ZIP_DEFLATED
                entry.external_attr = 0o100644 << 16
                archive.writestr(entry, assets[name], compress_type=zipfile.ZIP_DEFLATED, compresslevel=9)
    data = destination.read_bytes()
    return {'artifact': str(destination), 'sha256': hashlib.sha256(data).hexdigest(),
            'buildId': stamp['id'], 'files': len(assets),
            'runtimeBytes': sum(map(len, assets.values())), 'zipBytes': len(data),
            'signed': False}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--output', type=Path, help='New ZIP path; existing artifacts are never overwritten')
    args = parser.parse_args()
    manifest = json.loads((ROOT / 'manifest.json').read_text())
    output = args.output or ROOT / 'dist' / f"classroom-alerts-{manifest['version']}.zip"
    try:
        print(json.dumps(package(ROOT, output), indent=2))
    except (ValueError, OSError, KeyError) as error:
        parser.exit(1, f'Packaging failed: {error}\n')


if __name__ == '__main__':
    main()
