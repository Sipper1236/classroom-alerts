# Release and acceptance guide

**Acceptance boundary:** the 0.8.0 source and artifact include provisional summaries and aggregate catch-up, with automated/package verification below. These results do not establish live Classroom/Discord or full native workflow/performance acceptance. No school profile, session or real Discord destination was used in automated verification.

## Current artifact

- File: `dist/classroom-alerts-0.8.0.zip`
- SHA-256: `0b94c8a0b1f77d6479f311a43d88dc234d08228629cfb75421f89b27430ef7d9`
- Packaged build ID: `0.8.0-cc2b75ee23cd060a879e`
- Runtime: 13 allowlisted files, 144,469 uncompressed bytes; ZIP: 47,173 bytes.
- Signed: **no**. This is a development/temporary-install artifact, not a signed permanent distribution.

The source folder uses a human-readable development stamp. Packaged metadata is regenerated from runtime content, so editing a shipped asset changes the packaged build ID even if the displayed version is unchanged. Always reload Classroom tabs when switching packages or source builds.

Verified for this artifact: 97 Node tests, 28 Chromium browser tests, 3 packaging tests; packaged JS syntax/integrity/allowlist/stamp checks and byte-for-byte source reproduction; Firefox lint with zero errors/notices/warnings; isolated native temporary installation on a standalone retry. The first concurrent native smoke attempt timed out before install confirmation; that attempt was not counted as a pass. Older archives are preserved. See `CHANGELOG.md` and `ROADMAP-CHECKLIST.md` for implementation and acceptance evidence. Packaging is not live roadmap acceptance.

## Build and verify

```sh
python3 -m unittest discover -s tools -p '*_test.py' -v
python3 tools/package.py --output /path/to/new-release.zip
```

The packager uses only Python's standard library. It rejects missing/symlinked assets, references outside its runtime allowlist, inconsistent manifest/stamp versions, unexpected build metadata and obvious embedded webhook/private-key literals. This is not a comprehensive security audit or antivirus scan.

Archives have fixed entry timestamps/order/permissions. Two builds of the same inputs in the tested environment are byte-for-byte identical. Existing output files are never overwritten. Tools, tests, Markdown, personal settings, credentials, cookies, logs and recovery backups are not included.

Runtime allowlist:

```text
manifest.json  build.js  core.js  notifications.js  state.js
background.js  extractor.js  content.js
popup.html  popup.js  dashboard.html  dashboard.js  style.css
```

## Native linter and isolated smoke test

`web-ext` is development-only tooling. It is not a runtime dependency and is not bundled with the extension. The verified invocation used version 8.9.0 through the npm execution cache:

```sh
npx --yes web-ext@8.9.0 lint --source-dir . \
  --ignore-files '*.test.js' '*.md' 'tools/**' 'dist/**' \
  'test-harness.cjs' 'assignment-parser.js'

python3 tools/native_smoke.py dist/classroom-alerts-0.8.0.zip
```

The smoke script expects the tooling already cached (it runs npm offline), extracts only the reviewed ZIP entries into `/tmp/opencode`, launches a fresh temporary headless Zen profile and asserts a native temporary-add-on installation confirmation. It closes only its own process group and removes the temporary profile. It does not open or copy the student's normal profile, sign into school, export authentication cookies, or send Discord messages.

Observed on Zen 1.24b:

```text
Validation Summary: errors 0, notices 0, warnings 0
Installed .../extension as a temporary add-on
{"nativeTemporaryInstall":"passed", ... "liveClassroomVerified":false}
```

The headless run also produced browser-internal graphics/session-startup warnings. The successful install is **not** proof of the full native dashboard/API workflow, live Classroom extraction, or native CPU/RAM performance. Those remain separate acceptance checks.

## Temporary installation in the student's Zen profile

1. Open `about:debugging#/runtime/this-firefox`.
2. Select **Load Temporary Add-on…** and choose the ZIP, or choose `manifest.json` in the development folder.
3. Reload every existing Classroom tab.
4. Open the extension dashboard, confirm the intended account number and local profile, then collect the Classroom home page and select courses.
5. Save settings and scan. Compare representative results with Classroom itself before relying on alerts.

The temporary installation disappears after Zen restarts. A stale-script warning explains whether to reload affected Classroom tabs or first reload the extension itself; no tab is automatically refreshed and no school work is submitted or edited.

## Persistent installation

Use Mozilla's supported signing/distribution process, for example an approved unlisted signed add-on, and verify compatibility with the installed Zen release. This requires an appropriate Mozilla developer account and any school approvals applicable to deployment. No signing credentials are configured here, and nothing has been submitted or published.

- Temporary installation: <https://extensionworkshop.com/documentation/develop/temporary-installation-in-firefox/>
- Signing and distribution: <https://extensionworkshop.com/documentation/publish/signing-and-distribution-overview/>
- Zen extensions: <https://docs.zen-browser.app/user-manual/extensions>

Do not disable signature verification or weaken the student's browser security to make this ZIP permanent.

## Live acceptance checklist (not yet verified)

- [ ] Intended signed-in account confirmed; account order has not changed.
- [ ] Discovery matches enrolled selected courses.
- [ ] Representative home, stream, Classwork and detail pages match collected records.
- [ ] Last-card, no-date, submitted, missing and returned cases checked against the live UI.
- [ ] Local academic snapshots accurately reflect visible supported regions.
- [ ] School timezone and reminder windows confirmed.
- [ ] Explicit Discord test succeeds in the approved private channel.
- [ ] Quiet hours, pause/resume, restart recovery and live scan freshness checked.
- [ ] Native idle/scanning CPU and incremental RAM measured on the student's real workload.
- [ ] Signed installation verified if persistent distribution is required.

Until these are checked, use Classroom as the authoritative record. Automated fixtures are useful evidence for the tested failure cases, not proof that every school/layout or current live course is supported.
