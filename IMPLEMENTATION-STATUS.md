# Implementation audit

Updated 2026-11-06. This tracks evidence against `FEATURE-ROADMAP.md`; it does not replace that specification or declare live acceptance complete.

## Current release evidence — 0.8.0

- Source `0.8.0-r4`; packaged build `0.8.0-cc2b75ee23cd060a879e`. 97 Node, 28 Chromium browser and 3 packaging tests passed. New provisional coverage includes evidence-gated extraction; duplicate-title separation; bounds; atomic invalid-scope/oversize/unknown-field rejection; no planner/alert promotion; restart; backup/import conflict handling; partial scan coverage; and safe paginated UI/confirmed clearing.
- Latest per-course-page no-link snapshots are local observations, never durable assignment identity. No automatic matching to identified items occurs. Unknown empty/truncated results retain the old snapshot; explicit supported fresh snapshots replace it. Actual collection is limited to visible assignment evidence on known course pages.
- Aggregate catch-up has 9 targeted backend regressions plus a real-script dashboard preview regression: mixed events/item deduplication, stale/submitted/snoozed/imported/ambiguous/stale-detail exclusions, quiet hours, minimum spacing, persisted 429/restart handling, a 90-alert bounded summary, malformed/nested-job rejection, partial digest cursor retention and in-flight membership guards. A destination-wide integer rate-limit checkpoint prevents regenerated reminder windows from bypassing `Retry-After`.
- `dist/classroom-alerts-0.8.0.zip` passed exact runtime allowlist/integrity/syntax/stamp checks, byte-for-byte source reproduction and Firefox lint (0 errors/notices/warnings). Isolated native temporary install passed on a standalone retry; the first concurrent attempt timed out before confirmation. Browser-internal graphics/session warnings remain. See `RELEASE.md` for artifact hash/sizes.
- Actual school layouts, live Discord, native full dashboard/API/CSP workflow, user workload CPU/RAM, real sleep/resume timing and manual/assistive-technology UX remain acceptance gates, not inferred from fixtures or temporary installation. Earlier release sections below are historical.

## Current release evidence — 0.7.0

- Source stamp `0.7.0-r5`; artifact `dist/classroom-alerts-0.7.0.zip`, content-derived build `0.7.0-c320f8110f30062420cd`.
- 83 Node tests, 25 Chromium browser tests and 3 packaging tests passed. The versioned package passed syntax, integrity, exact runtime allowlist and stamp checks, Firefox lint (0 errors/notices/warnings), and isolated native temporary installation. See `RELEASE.md` for hash and sizes.
- Added daily count-only stale-health alerts, selected/current-course scans, per-course attempt/success/detail counters, controlled read-only expansion and explicit visible empty-Classwork evidence.
- Added one-hour verbose expiry and late-response stripping, exact local Discord preview, preserved-record scoped absence annotations, chosen-time/clear snooze, school-day pinning and composable course/deadline/review/today filters.
- Accessibility/UI regressions cover real labels, keyboard focus (including restoration after task saves), summary toggling, light/dark panels, 320px width with 200% text sizing, no decorative animation under reduced motion, selectable redacted clipboard fallback, entered-secret reveal/remasking, and distinct empty/running/unsupported/sign-in/failure/Discord states.
- These checks are not screen-reader certification or a native browser-zoom/visual audit. Native full dashboard/API/CSP flows, live Classroom, actual Discord delivery, signed distribution and native workload CPU/RAM remain unverified. Browser-internal startup/graphics warnings occurred in the installation-only smoke.
- Mandatory implementation gaps remain: provisional no-link summary records and aggregate sleep catch-up. Do not interpret this release or the historical evidence below as roadmap completion.

Current Node command: `node --test planning.test.js scan-controls.test.js workflow.test.js notifications.test.js state.test.js academic.test.js version.test.js core.test.js background.test.js extractor.test.js assignment-parser.test.js`.

Current browser command: `NODE_PATH=/path/to/playwright/node_modules node --test --test-concurrency=1 browser.test.js content-version.test.js dashboard.test.js`.

The earlier 0.6.0-specific test counts and artifact evidence below are historical; current counts are above.

## Verified in automated tests

### Extraction and local records

- Stable same-account course and assignment identity.
- Separate assignment-detail and summary extraction; generic navigation list items are not treated as homework.
- Bounded DOM scanning rather than unbounded whole-site collection.
- Final home card and no-date assignment fixture coverage without a next-card token requirement.
- Explicit uncertainty for weekday-only, ambiguous numeric, date-only and DST deadlines.
- Local edits survive merges; missing pages do not delete existing records.
- Deterministic recommendations work without AI.
- Grades are opt-in and excluded from outbound messages.

### Orchestration

- One inactive scanner tab and serialized scans.
- Navigation readiness retries do not accept old-page records.
- Follows observed Classwork links within the selected account and course.
- Cancellation during discovery prevents subsequent course visits.
- Pause during navigation stops readiness retries; resume visits remaining selected courses.
- Partial course failures do not erase existing records or suppress independent course results.
- Detail failures and detail-budget exhaustion make the run partial.
- Each run visits at most 30 stale/unverified details per course; retry continues the rest using verified checkpoints.
- Account redirects are rejected without importing the other account's records.
- Interrupted runs preserve tasks and restore alarms on startup; explicit resume is available.

### Discord and scheduling

- Strict webhook destination validation and mention suppression.
- Bounded messages; private diagnostic content and grades excluded.
- Rate-limit retry timing, transient retry backoff, invalid-webhook suspension and eight-attempt cap.
- Queued reminders are invalidated after submission, snooze, local completion, deadline change, deselection or expiration.
- Quiet hours, deadline windows, stale-verification exclusion and reminder deduplication.
- Pending digest survives restart; old-day digest jobs are not replayed as current data.
- Network requests do not hold the database writer or block cached UI reads.
- Changing/disabling a webhook clears pending messages so an old queue is not sent to a new destination.
- Configurable reminder windows, digest/reminder/new-assignment/deadline-change event switches, and minimum automatic delivery spacing.
- Initial course baselines suppress historical new-item floods; re-enabling events does not replay past changes.
- Confirmed detail deadlines use semantic comparison and monotonic revisions, so formatting-only changes do not notify and a later move back to an earlier deadline remains a new event.
- Versioned persisted job schemas reject unknown kinds, raw message content, invalid IDs/cursors/retry metadata, and stale fingerprints. Legacy text jobs are discarded rather than replayed.
- Outbound text is generated from current records, not trusted saved message bodies. Pending new/deadline messages refresh after verified title/detail updates.
- A summary/detail disagreement suppresses precise item alerts pending re-verification.
- Multipart digests retain their acknowledged cursor across restart. Changes while a send is in flight do not falsely acknowledge a newer version.
- Saving unrelated settings does not reinterpret relative deadlines against a new day; timezone reinterpretation uses the evidence timestamp.

### UI and resource controls

- Real popup/dashboard scripts exercised in Chromium using the mocked background coordinator.
- Extracted text renders as text, not executable HTML.
- Filters, effort/note edits, locally complete and restore actions tested.
- Saved webhook is not displayed, and can be preserved or disabled in settings.
- Diagnostic copy excludes raw school text/account routing by default.
- Partial coverage remains visible.
- At most 25 task forms are rendered; pagination is keyboard operable.
- Popup with 200 cached tasks renders 23 DOM elements and performs no database writes.
- No content-script polling, production framework, bundled browser engine or server.

### Validated storage, imports and retention (development build 0.5.0)

- A versioned data boundary validates settings, account/course/task identities, evidence timestamps, derived deadlines, local edits, collection limits, checkpoints, diagnostics and history before use and before commit.
- Known schema v1 migrates to v2 without dropping valid tasks or notes. A corrupt record/settings/root or unsupported schema blocks writes and automation while leaving the original primary storage unchanged.
- Validated records remain available for a secret-free recovery export. Explicit recovery is available only for supported schemas, keeps a local original-data backup, disables delivery and course selection, and marks recovered tasks unverified. Incompatible newer formats are never silently downgraded.
- Imports are UTF-8-byte limited, reject unsafe/foreign-account/unsupported/secret-bearing payloads, preview conflicts without writing, and use a revision guard before explicit confirmation.
- Keep-existing and replace-snapshot policies both preserve current local edits. Imported tasks are excluded from all outbound events and digests until a normal detail verification. Imports do not change settings or enable delivery.
- Configurable completed-task/diagnostic/activity retention, previewed cleanup, individual deletion, history clearing, reset, and local recovery-backup deletion have separate controls.
- Completion timestamps survive rescans; retention never removes unfinished work merely because it is old or overdue. Task retention defaults to off.
- Storage-write failures are tested to leave migration sources and pre-import records intact. Deletion resets course notification baselines so rediscovered historical work is not treated as a new-item flood.
- Browser UI tests exercise import preview/confirmation, visible recovery state, and retention policy/cleanup preview.
- Read-only task CSV export escapes spreadsheet formulas, quotes and newlines, and excludes credentials, queues and diagnostic content.

### Script compatibility, academic views and packaging (development build 0.6.0)

- Captured content/core/extractor build stamps and a per-request protocol/nonce handshake are checked before collection and again before ingestion. Old `getManifest()` values cannot relabel already loaded scripts.
- Known stale responses fail immediately instead of being retried as page readiness failures. Popup/dashboard show reload guidance and affected tabs; a valid recheck clears only its tab warning. Mixed background/module/manifest builds block automated writes and actions.
- Real-browser tests execute stale/mixed content scripts against the actual mocked coordinator, assert no DOM scan or scrolling occurs on mismatch, and confirm reload repairs ingestion.
- Academic snapshots have separate filtered/paginated local announcement/material/grade views and task instruction/resource details. Source, last-seen and imported status are visible.
- Grade evidence is scoped to own-work/grade regions; unrelated points examples and private-comment text do not become grade snapshots or announcement bodies. Grade history is bounded to ten entries and removed on opt-out.
- Background settings enforce academic collection categories independently of content filtering. Academic text, resource names and grades are excluded from Discord messages.
- Reproducible runtime-only ZIP packaging uses a 13-file allowlist and content-derived build stamp; tests verify deterministic bytes, exclusion of secret files, symlink/reference/version rejection and existing-artifact preservation.
- Firefox extension lint passed with 0 errors, 0 notices and 0 warnings. The ZIP installed temporarily in a fresh headless Zen 1.24b profile. No school session or real Discord destination was used.

## Test commands and observed results

```sh
node --test academic.test.js version.test.js workflow.test.js notifications.test.js state.test.js background.test.js core.test.js extractor.test.js assignment-parser.test.js
# 68 tests passed, 0 failed

NODE_PATH=/path/to/playwright/node_modules node --test --test-concurrency=1 dashboard.test.js browser.test.js content-version.test.js
# 16 tests passed, 0 failed

python3 -m unittest discover -s tools -p '*_test.py' -v
# 3 packaging tests (run separately from native installation)
```

The browser commands require development-only Playwright and a Chromium executable. They do not install anything in the user's normal browser, sign into school, or send real Discord requests.

The popup fixture timings vary with test-runner/host load and include browser/tooling overhead; they are not native performance guarantees. Its exposed heap metric was rounded by Chromium and is **not** a reliable process RAM measurement. No native Zen CPU/RAM target is claimed.

## Not yet complete / further independent work

- Native Zen temporary installation is verified; full native dashboard/CSP/API workflows and actual Classroom DOM remain to be verified.
- Signed/unlisted persistent distribution is not performed; the reproducible unsigned runtime-only package is implemented. See RELEASE.md.
- Complete extraction of all instruction/announcement text across observed live layouts.
- Safe automatic expansion of collapsed read-only sections; the current scan scrolls but deliberately does not click unverified controls.
- Positive empty-course detection: zero matches remain partial/unknown, never a confident “no homework.”
- Further adversarial/large-dataset profiling and native storage-quota behavior verification. Validated state loading, known-version migration and explicit corrupt-data recovery are implemented and covered by mocks.
- Optional additional notification categories (announcement/grade/health changes), per-course event preferences, and more advanced aggregate catch-up summaries. Core assignment/deadline events, configurable windows and spacing are implemented.
- JSON import conflict handling, task CSV export and history/retention/deletion controls are implemented. Imports are limited to 2 MiB; very large JSON exports may need partitioning in a future release.
- Profile identity confirmation beyond a local label and `/u/N/` account position; account reordering is still an important manual check.
- Script version-mismatch detection is implemented and tested, including mixed modules and a misleading current `getManifest()` version in an old content context.
- Explicit current-course scan button and richer per-course freshness/detail counters.
- More calendar/date/locale fixtures and performance profiling. Automatic age-based diagnostic expiration is implemented.
- Optional AI, reviewed document extraction, calendar export, Notion and extra messaging destinations are not implemented. These remain optional/deferred in the roadmap; no undisclosed provider or service has been added.

## User-assisted acceptance still required

1. Load the extension in Zen and confirm the intended signed-in school account.
2. Verify discovery and representative detail/home/Classwork layouts against the live UI.
3. Compare the collected workload against Classroom manually, including missing and returned work.
4. Explicitly send a test to the approved private Discord channel.
5. Verify quiet hours, timezone, restart behavior, and native browser resource use on the actual machine.

Until then, keep Classroom itself as the authoritative homework record. Tests prove behavior for the tested fixtures and mocked failures, not universal compatibility or complete live-account coverage.
