#!/usr/bin/env python3
"""Smoke-test an unsigned package in an isolated headless Zen profile (no school login)."""
import argparse
import json
import os
from pathlib import Path
import re
import signal
import subprocess
import tempfile
import zipfile

from package import RUNTIME


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('artifact', type=Path)
    parser.add_argument('--browser', default='/usr/bin/zen-browser')
    args = parser.parse_args()
    with tempfile.TemporaryDirectory(prefix='classroom-native-', dir='/tmp/opencode') as directory:
        root = Path(directory)
        source = root / 'extension'
        source.mkdir()
        with zipfile.ZipFile(args.artifact) as archive:
            assert set(archive.namelist()) == set(RUNTIME), 'Unexpected package files'
            archive.extractall(source)
        env = {**os.environ, 'TMPDIR': directory, 'MOZ_HEADLESS': '1'}
        command = ['npx', '--offline', '--yes', 'web-ext@8.9.0', 'run', '--no-config-discovery',
                   '--no-input', '--no-reload', '--verbose', '--source-dir', str(source),
                   '--artifacts-dir', str(root / 'artifacts'), '--firefox', args.browser,
                   '--args=-headless', '--start-url=about:blank']
        proc = subprocess.Popen(command, env=env, stdout=subprocess.PIPE, stderr=subprocess.STDOUT,
                                text=True, start_new_session=True)
        try:
            try:
                output, _ = proc.communicate(timeout=25)
            except subprocess.TimeoutExpired:
                os.killpg(proc.pid, signal.SIGINT)
                try:
                    output, _ = proc.communicate(timeout=10)
                except subprocess.TimeoutExpired:
                    os.killpg(proc.pid, signal.SIGTERM)
                    output, _ = proc.communicate(timeout=5)
        finally:
            if proc.poll() is None:
                os.killpg(proc.pid, signal.SIGKILL)
                proc.wait()
        print(output)
        installed = bool(re.search(r'Installed .+ as a temporary add-on|Installed add-on|Temporary addon installed', output, re.I))
        assert installed, 'No native temporary-install confirmation; smoke test did not pass'
        assert 'Error: Installation failed' not in output, 'Native installation failed'
        print(json.dumps({'nativeTemporaryInstall': 'passed', 'browser': args.browser,
                          'profile': 'isolated temporary profile (removed)', 'schoolLogin': False,
                          'liveClassroomVerified': False, 'discordDeliveryVerified': False}))


if __name__ == '__main__':
    main()
