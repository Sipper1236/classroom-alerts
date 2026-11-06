import importlib.util
import json
from pathlib import Path
import shutil
import tempfile
import unittest
import zipfile

spec = importlib.util.spec_from_file_location('extension_package', Path(__file__).with_name('package.py'))
packager = importlib.util.module_from_spec(spec)
spec.loader.exec_module(packager)


class PackagingTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(dir='/tmp/opencode')
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name) / 'source'
        self.root.mkdir()
        for name in packager.RUNTIME:
            shutil.copy2(packager.ROOT / name, self.root / name)

    def test_reproducible_allowlist_excludes_secrets_and_generates_content_stamp(self):
        (self.root / 'credentials.json').write_text('DO NOT SHIP')
        (self.root / 'browser-session.json').write_text('PRIVATE COOKIE')
        (self.root / 'private.test.js').write_text('SECRET FIXTURE')
        first = packager.package(self.root, Path(self.temp.name) / 'first.zip')
        second = packager.package(self.root, Path(self.temp.name) / 'second.zip')
        self.assertEqual(first['sha256'], second['sha256'])
        with zipfile.ZipFile(first['artifact']) as archive:
            self.assertEqual(set(archive.namelist()), set(packager.RUNTIME))
            self.assertNotIn(b'PRIVATE COOKIE', b''.join(archive.read(n) for n in archive.namelist()))
            self.assertIn(first['buildId'].encode(), archive.read('build.js'))
        (self.root / 'style.css').write_text((self.root / 'style.css').read_text() + '\n/* changed */\n')
        changed = packager.package(self.root, Path(self.temp.name) / 'changed.zip')
        self.assertNotEqual(first['buildId'], changed['buildId'])

    def test_missing_symlinked_unreviewed_or_mismatched_assets_fail_without_overwrite(self):
        target = Path(self.temp.name) / 'existing.zip'
        target.write_bytes(b'USER ARTIFACT')
        with self.assertRaises(FileExistsError):
            packager.package(self.root, target)
        self.assertEqual(target.read_bytes(), b'USER ARTIFACT')
        (self.root / 'style.css').unlink()
        (self.root / 'style.css').symlink_to(packager.ROOT / 'style.css')
        with self.assertRaisesRegex(ValueError, 'symlinked'):
            packager.package(self.root, Path(self.temp.name) / 'bad.zip')
        (self.root / 'style.css').unlink()
        shutil.copy2(packager.ROOT / 'style.css', self.root / 'style.css')
        manifest = json.loads((self.root / 'manifest.json').read_text())
        manifest['background']['scripts'].append('private.test.js')
        (self.root / 'manifest.json').write_text(json.dumps(manifest))
        with self.assertRaisesRegex(ValueError, 'allowlist'):
            packager.package(self.root, Path(self.temp.name) / 'unreviewed.zip')
        manifest['background']['scripts'].pop()
        manifest['version'] = '9.9.9'
        (self.root / 'manifest.json').write_text(json.dumps(manifest))
        with self.assertRaisesRegex(ValueError, 'version must match'):
            packager.package(self.root, Path(self.temp.name) / 'version.zip')

    def test_literal_webhook_secrets_are_rejected_before_creating_release(self):
        file = self.root / 'background.js'
        file.write_text(file.read_text() + '\n// https://discord.com/api/webhooks/123/PRIVATE_TOKEN\n')
        output = Path(self.temp.name) / 'leaked.zip'
        with self.assertRaisesRegex(ValueError, 'Possible embedded secret'):
            packager.package(self.root, output)
        self.assertFalse(output.exists())


if __name__ == '__main__':
    unittest.main()
