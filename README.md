# Classroom assignment alerts for Zen

This dependency-free Zen/Firefox extension collects permitted Classroom UI data using your normal signed-in session. It stores a local workload queue, recommends unfinished work without AI, and can send Discord digests/reminders. It does not use Google OAuth, the Classroom API, password automation, exported cookies, or a server.

**Status: packaged development build 0.8.0.** Current suites pass 97 Node tests, 28 Chromium browser tests and 3 packaging tests. The 0.8.0 runtime package passes reproducibility, syntax/integrity checks and Firefox lint (0 errors/notices/warnings). Native temporary installation passed on a standalone retry after the first smoke attempt timed out. This does not certify full native workflow, live Classroom/Discord or workload CPU/RAM; those acceptance checks remain unverified. Do not rely on it as your only homework record yet.

The 0.8.0 source adds **Provisional summaries**: visible assignment cards without stable links on a known course page are separate, local, unverified observations. They never receive invented item IDs, merge by title, enter the planner or trigger Discord. Open the course-scope link to verify details. Collection is capped at 50 per page and storage at 200 observations; fresh supported scans replace that scope's snapshot, while unknown empty/truncated results preserve it. Duplicate titles remain distinct observations. JSON backup/import includes these snapshots with explicit per-scope conflict handling; task CSV excludes them. Clearing provisional snapshots does not touch identified assignments. Unsupported/home layouts without known course context still require live verification.

After a scheduling gap of at least 30 minutes (sleep/closed-browser detection uses no system telemetry), multiple eligible missed new/deadline/reminder/digest events become one current-state **Homework catch-up**. Invalid/expired/submitted/snoozed/unverified reminder events are dropped; each current task appears once. The single message is bounded to Discord's limit; overflow points to Dashboard instead of replaying more messages. Events are acknowledged only after successful delivery, including ones represented by the overflow summary. Quiet hours, spacing, persisted retries and destination-wide `Retry-After` still apply. Partly delivered digests keep their existing cursor rather than being folded into a new summary. A crash after Discord acceptance can still cause a duplicate: delivery remains at-least-once, not exactly-once.

The 0.7.0 source adds count-only daily stale-scan warnings, current-course scans, per-course coverage counters, conservative bounded read-only expansion, and explicit visible empty-Classwork evidence. Verbose diagnostics expire after one hour (including restarts); an unrelated settings save does not extend the session. Expiry is applied on the next extension request/alarm, and late scan responses cannot restore verbose text while it is disabled. **Preview Discord messages locally** shows exact current digest/valid queued-event text using the delivery renderer, without network requests or queue changes. These source additions are not in the existing 0.6.0 ZIP.

Successful bounded course scans annotate previously collected records not seen in the checked scope, with a timestamp and link to that scope. This is **not** evidence that an assignment was deleted or completed: its status, deadline, local notes and work-queue entry stay intact. Unknown empty results, truncated/failed/cancelled scans and failed detail checks cannot create the annotation. A newer concurrent sighting takes precedence, and seeing the record again clears it. JSON backups preserve the annotation; importing a backup discards this live-scan claim until the local scanner checks again.

Local planning controls include **Pin for today's plan** (expires at midnight in the saved school timezone), **Snooze until chosen time** (device timezone, within 30 days), and **Clear snooze**. Pins prioritize unfinished work but do not override snooze or completion. Course, deadline, verification-state and today's-plan filters can be combined with search and your time budget without changing stored records. Pins and snoozes survive scans/restarts and are preserved in JSON backups; none of these controls submits or changes work in Classroom.

## Install in Zen for testing

1. Open `about:debugging#/runtime/this-firefox`.
2. Choose **Load Temporary Add-on…** and select this folder's `manifest.json`.
3. Open **Dashboard & settings** from the extension popup. Set a local profile label, account number from your Classroom URL (for example `/u/1/`), school timezone, and optional private Discord webhook.
4. Save settings. Open your signed-in Classroom home page in the same Zen window and select **Collect current Classroom page** in the dashboard.
5. Select discovered courses and save settings again. Select **Scan selected courses**. One inactive scanner tab visits courses serially; the active homework tab is not redirected.
6. Use **Refresh view** for progress. Review partial failures, task status, and deadlines before trusting reminders. Use **Send Discord test** only when ready to send an external test message.

Temporary add-ons are removed when Zen restarts. Persistent distribution needs Mozilla signing/Zen verification; this project does not disable browser security. Reload Classroom tabs after reloading the extension so content scripts update.

The extension must have Zen running and the computer awake. Default scans are hourly (minimum 15 minutes), reminders are checked every five minutes, and there is no per-page polling. Each course scan scrolls at most six times and visits at most 30 stale/unverified assignment details. These are explicit coverage limits, not a full-account completeness guarantee. Background tabs may be throttled.

Normal diagnostics contain counts and rejection reasons. Enable **Verbose local diagnostics** only for troubleshooting; it may expose school text locally. **Copy diagnostic summary** excludes raw school text by default. Preview/redact any report before sharing. Reports are never automatically uploaded.

Create a private Discord channel, add an incoming webhook for that channel, and paste its URL into the extension settings. Treat the webhook URL like a password; anyone with it can post to that channel.

## Current behavior and limits

- Uses observed same-account course/item links, not hidden Google endpoints.
- Accepts valid assignments without due dates; ambiguous dates remain review tasks.
- Uses stable course/assignment identity, preserves local effort/notes, and does not delete tasks omitted by a partial scan.
- Date-only values never become invented midnight deadlines; ambiguous weekday and DST times do not schedule precise reminders.
- Daily digests and configurable due-soon reminders respect quiet hours. Default reminder windows are 24 and 3 hours; Settings accepts up to eight windows between 0.25 and 720 hours. Exact-time reminders require a detail verification within 24 hours.
- New-assignment and confirmed deadline-change alerts have separate switches. Historical work does not produce a new-item flood during a course's first successful baseline scan. These are discovery alerts, not proof of when a teacher posted an assignment.
- Automatic messages have configurable minimum spacing (default 15 minutes). Explicit test messages bypass this spacing but still respect quiet hours. Re-enabling an event does not replay past changes.
- Persisted jobs have a versioned metadata schema and are rendered from current records. Submitted/snoozed/deselected tasks and superseded windows/deadlines invalidate pending events. New/change events expire after 48 hours. Older pre-0.4 pending text jobs are discarded rather than replayed; diagnostics record the count removed on startup.
- Unverified summary changes suppress item alerts until detail evidence is refreshed. Deadline-format changes that represent the same instant do not trigger deadline-change alerts.
- One-way Discord webhook delivery only. Quiet hours also defer test messages; the queue/delivery status explains pending sends.
- Webhook messages contain title, course, raw deadline, visible status, and links. Grades, private comments, and debug reports are excluded.
- Announcement/material link detection and visible grade parsing are opt-in and layout-dependent. Full announcement text, full instruction extraction across all layouts, AI, calendar export, and signed distribution are not complete.
- Academic snapshots have their own local dashboard view, with filters, pagination, source/freshness labels, instructions/resource links, and at most ten local grade snapshots per assignment. Only supported post/description regions are read; private comments are not scraped into announcement bodies. Grade parsing is scoped to own-work/grade regions, never an arbitrary points example in instructions. Disabling grade collection clears grade values/history.
- Stale or mixed content scripts are rejected before their data is ingested, even if `getManifest()` reports the newly installed version. Dashboard/popup show reload guidance, affected tab IDs and build stamps; a valid recheck clears that tab's warning. Mixed background/manifest installations block automated actions and ask you to reload the extension first.
- No task action changes Classroom. “Locally complete” does not submit work.
- Local storage is not an encrypted secret vault. Exports contain private school task data but not webhook secrets.
- Saved state is validated before use and before writes. Supported v1 data migrates to schema v2; corrupt/incompatible data is left untouched and automation is blocked. Dashboard offers a validated-record export and explicit supported-schema recovery. Recovery keeps an original-data backup locally (which may include saved secrets) until you explicitly delete it.
- Imports are previewed, limited to 2 MiB of UTF-8 JSON and the configured account/profile, and reject settings, credentials, queues, unsafe keys and unsupported schemas. Conflict choices are keep-existing or replace-Classroom-snapshot; both preserve existing local notes/progress. A stale preview is rejected. Imported records cannot generate any alerts/digests until a real detail-page verification.
- Completed-task retention is off by default. Optional cleanup only removes submitted/locally complete tasks with a recorded completion age; unfinished work stays. Diagnostic reports expire after 24 hours by default and activity after 30 days. Cleanup is bounded to at most hourly while active. Manual cleanup previews show what will be removed, and destructive controls require confirmation.
- Task history can be cleared without deleting notification settings; reset clears the primary data/settings. Recovery backups have their own explicit deletion control. Deleted tasks can reappear after a later Classroom scan, and affected course notification baselines reset to avoid rediscovery floods.
- Delivery is at-least-once: a crash after sending but before acknowledgement can cause a duplicate.

## Development checks

Pure logic and mocked background tests require only Node:

```sh
node --test core.test.js extractor.test.js background.test.js assignment-parser.test.js workflow.test.js notifications.test.js state.test.js version.test.js academic.test.js scan-controls.test.js planning.test.js provisional.test.js catchup.test.js
```

Browser DOM fixture tests use development-only Playwright (not bundled in the extension):

```sh
NODE_PATH=/path/to/installed/node_modules CHROMIUM_PATH=/path/to/chromium node --test --test-concurrency=1 browser.test.js content-version.test.js dashboard.test.js
```

See `FEATURE-ROADMAP.md` for the full target specification. Implemented code is not evidence that live-account acceptance has passed.

Run `node --test workflow.test.js` for mocked end-to-end scan, restart, cancellation, reminder and retry scenarios. `IMPLEMENTATION-STATUS.md` records current verified behavior and remaining gaps.

**Pause scan** stops after the current bounded operation; **Resume remaining** uses the saved course checkpoint. **Retry failed courses** also continues courses with a partial/detail-budget result. Submitted and locally complete tasks can be reviewed/restored using the dashboard checkbox. Use the explicit Discord enable checkbox to disable saved webhook delivery.

## Runtime-only release package

`dist/classroom-alerts-0.8.0.zip` is an unsigned, 13-file runtime package (47,173 bytes compressed). Older archives are preserved separately. For a temporary install, select the ZIP in Zen's **Load Temporary Add-on** dialog. Reload existing Classroom tabs afterward.

Build a new package with `python3 tools/package.py --output /path/to/new-release.zip`; existing output files are never overwritten. The package has a content-derived build ID, contains no tests/configuration/credentials, and needs no production dependencies. Developer checks: `python3 -m unittest discover -s tools -p '*_test.py' -v`.

See `RELEASE.md` for artifact verification, isolated native smoke testing, and the separate Mozilla-signing requirement for persistent installation. An unsigned ZIP is not a permanently installable signed release.
