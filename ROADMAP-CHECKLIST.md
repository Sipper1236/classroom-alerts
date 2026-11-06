# Roadmap-to-artifact acceptance checklist

Audit date: 2026-11-06. Source specification: `FEATURE-ROADMAP.md`.

**V** = implemented with automated evidence; **P** = partial / work remains;
**L** = requires user-assisted live acceptance; **O** = explicitly optional/deferred;
**N** = prohibited/non-goal, intentionally absent. A V is not a live-account certification.

## Product, constraints and references (§1–5)

| Requirement | Status | Artifact / evidence |
| --- | --- | --- |
| Standalone lightweight Zen extension, no server/Electron/framework | V | `manifest.json`, runtime allowlist in `tools/package.py`; 13-file ZIP |
| Useful workload queue without AI | V | `core.js:plan`, `core.test.js`, dashboard browser tests |
| Read normal signed-in UI; no Google OAuth/API/password/cookie export | V/L | Host-limited manifest and `content.js`; live login/account confirmation remains L |
| Read-only school actions, no submission/comment/enrollment mutations | V/L | Navigation-only background; expansion safety regression must remain green; live UI confirmation L |
| No hidden Google endpoints or external-service crawling | V | `core.js:classroomURL`, route/host validation; network mocks |
| Disclose browser-closed, asleep and stale-data limits | V | README, RELEASE.md; no always-on claim |
| Reference all 13 unique repositories and license/trust caveats | V | Roadmap §4; no third-party project source copied into runtime |
| Prioritize P0/P1 over optional integrations | V | Goal plan, local-first implementation; optional list below |

## Course discovery and scanning (§6)

| Requirement | Status | Artifact / evidence |
| --- | --- | --- |
| Preserve selected `/u/N/` context; reject other accounts | V/L | `core.js:identity`, `background.js:readTab`; workflow/account-redirect tests; account reorder confirmation L |
| Explicit local profile binding and no silent profile switch | V | Settings validation and import/recovery tests |
| Course names, selection, deduplication and discovery refresh | V | `extractor.js`, dashboard course list; DOM fixture and workflow tests |
| Archived classes opt-in, not automatically crawled | V/L | Only selected discovered courses scanned; no archived-page traversal; live course list L |
| Explain incomplete/unknown discovery | V/L | Unknown-layout report and per-course partial/error/attempt/success/detail counters; live course coverage remains L |
| One inactive scanner tab; no active homework-tab takeover | V | `workflow.test.js` serial/inactive tab assertions |
| Follow observed Classwork/detail links; bounded readiness | V | `background.js:scanAll/readTab`, workflow navigation tests |
| Bounded safe scrolling/expansion, no blind clicking | V/L | `content-version.test.js` executes capped known-panel expansion; skips submission/comment/form/unknown controls; live supported-control coverage L |
| Course/page scope labels and last attempt vs last success | V | Dashboard per-course counters, `scan-controls.test.js` and workflow tests |
| Never interpret zero matches as no homework | V | Unknown-layout warning; zero results remain partial |
| Positive empty-course detection from explicit UI evidence | V/L | Visible exact Classwork status markers only; browser fixture and `scan-controls.test.js`; live wording/layout L |
| Dynamic navigation, duplicate listeners and bounded settling | V/L | Listener guard, route checks and bounded MutationObserver settling in `content.js`; synthetic browser tests, live navigation L |
| All-course / current-course / page / pause / cancel / retry controls | V | Popup current-course and dashboard per-course action; backend account/selection gates tested in `scan-controls.test.js`; pause/resume/cancel/retry workflow tests |
| Persist before recommending/notifying | V | Serialized transaction writer; queue/state workflow tests |

## Academic information and extraction (§7–8)

| Requirement | Status | Artifact / evidence |
| --- | --- | --- |
| Stable course/task identity, exact observed permalink | V/L | `core.js`, extractor fixtures; live permalink/layout check L |
| Titles, raw deadline, status, source and freshness | V | State schema and task UI; core/state tests |
| No-date/unknown-date tasks remain visible | V | Core/DOM tests and review rationale |
| Instructions/resource metadata without automatic downloads | V/L | Known-region extractor and academic views; unsupported live regions remain L |
| Own-work status; returned != automatically complete | V | Own-work extraction and status/plan fixtures |
| Separate local progress from Classroom submission | V | Dashboard labels, local edits tests |
| Separate announcement/material views and consent switches | V/L | `academic.test.js`, academic DOM/UI tests; layout-dependent live coverage L |
| No private comment/roster forwarding | V | Scoped regions and academic privacy tests |
| Optional announcement alerts by course | O/P | Local collection implemented; additional message sharing not enabled by default; future opt-in extension |
| Grade snapshots/history local and opt-in; no fake averages | V | Bounded ten-entry history, own-work evidence, opt-out tests |
| Grade forwarding separate and off | V/O | No grade forwarding implemented; explicit future consent required |
| Structured card boundaries, not next-card token guesses | V | Final-card DOM regression and no-date fixture |
| Exact reported live structures, not merely synthetic approximations | L | User reports informed fixtures, but live sanitized DOM capture still needed |
| Month/year/date-only/relative/weekday/ambiguous/DST handling | V/L | `core.test.js`, notification relative-date regression; live timezone confirmation L |
| Preserve original date/confidence; no invented midnight/year certainty | V | `core.js:dueDate`, state validation and date tests |
| No exact reminders from ambiguous dates | V | Reminder eligibility and unknown-date tests |

## Records, planning and backups (§9–10)

| Requirement | Status | Artifact / evidence |
| --- | --- | --- |
| Profile/course/item identity rather than title/date/page key | V | Merge and cross-account validation tests |
| Provisional summary without stable link | V/L | Visible, explicit assignment-card evidence on a known same-account course page yields a separate unverified observation, not a fabricated task ID. Latest per-scope snapshots are bounded to 50 per report / 200 stored, paginated locally, excluded from recommendations/Discord/CSV and never title-merged. Unknown empty/truncated results preserve prior snapshots; JSON backup/import validates scope, previews counts and uses per-scope conflict policy. `provisional.test.js` (5 regressions), browser extraction and dashboard pagination/XSS/clear tests pass. Home cards without established course context and unsupported live layouts remain L. |
| Independent title/deadline/status/grade changes | V | Revisions, local activity and grade snapshots; notification tests |
| Detect no-longer-seen records without deleting/completing them | V/L | Successful nontruncated bounded course scans add timestamp + checked-scope link; failures/unknown emptiness/cancellation/detail failures do not. Newer concurrent sightings take precedence; seeing a record again clears the annotation. `scan-controls.test.js` verifies preserved status/dates/notes, restart/export/import boundaries and validation; dashboard browser test verifies retained queue entry and warning. Live layout coverage remains L; absence never proves removal/completion. |
| Local edits survive collection; imports cannot replace notes silently | V | State/import/UI regression tests |
| JSON/CSV export excludes secrets; formula-safe CSV | V | `state.test.js` export tests, runtime data boundary |
| Validated import, explicit conflict policy and revision guard | V | Import tests, dashboard preview/confirm flow |
| Separate diagnostics/history/reset/backup deletion controls | V | State and dashboard tests |
| Deterministic urgency with reasons and user estimates only | V | Planner and UI tests; no AI dependency |
| Unknown effort stays unknown; simple time budget | V | Planner reasons and dashboard filter |
| Local notes/progress/snooze and course exclusion | V | Task controls and course selection tests |
| Snooze until a chosen time, pin for today's plan | V | Device-time chosen snooze (up to 30 days), clear snooze and school-day pinning. `planning.test.js` verifies school-midnight expiry, snooze/completion precedence, validation and persistence through scan/restart/backup; dashboard test exercises actual controls and invalid-time feedback. |
| Group/filter by deadline/course/review state | V | Composable course, overdue/upcoming/no-date/uncertain-deadline, verification-state and today's-plan filters retain pagination and records. Dashboard browser test verifies each filter and combinations. Existing title/time-budget/completed controls retained. |

## Discord and reliability (§11, §16)

| Requirement | Status | Artifact / evidence |
| --- | --- | --- |
| Private-channel disclosure, exact webhook validation, explicit test | V/L | Settings, URL tests; live external test L |
| Preview exact outbound fields | V | `notifications.js:preview` shares digest renderer with delivery; `academic.test.js` verifies matching text/no writes/no sends/no academic bodies or credentials; dashboard browser test verifies safe text rendering |
| New assignment / deadline / due-soon / daily events | V | Versioned metadata jobs and notification tests |
| Missing/overdue summary | V | Included in daily digest; explicit Missing in Classroom and Overdue filters with counts in the dashboard, verified by the planning UI test |
| Stale scan-health warning after meaningful interval | V | Count-only daily durable health job; configurable 1–168-hour threshold; quiet/disable/recovery/restart regressions in `scan-controls.test.js` |
| Length bounds, escaping, mention suppression | V | Core, background and delivery tests |
| Durable queue, success acknowledgement, 429/backoff/invalid webhook | V | Workflow/notification retry and restart tests |
| Serialize updates without blocking UI on network | V | Transaction writer and in-flight delivery regression |
| Quiet hours, timezone, course inclusion, configurable windows/spacing | V | Notification settings and UI tests |
| Initial-baseline suppression and no stale submitted reminders | V | Initial sync, invalidation, restart tests |
| Catch-up after sleep instead of replaying stale windows | V/L | A ≥30-minute scheduling gap aggregates multiple eligible new/deadline/reminder/digest events into one bounded current-state summary. No stale-window replay; item deduplication, omitted-overflow notice, success-only child acknowledgements, persisted quiet/spacing/429/restart behavior, cursor preservation for partly delivered digests and in-flight revision guards. `catchup.test.js` (9 tests) and real-script dashboard preview test pass. Real sleep/resume/device timing remains live acceptance. |
| At-least-once limitation disclosed, no exactly-once claim | V | README and roadmap audit |
| Browser alarms own scheduling, no per-page polling | V | Background alarms and no-content-timer design |
| Recover interrupted work without data loss | V/L | Mocked restart/checkpoints; native live restart L |
| Clear error categories and bounded retries | V/L | Login/version/timeout/storage/delivery/unknown-layout messages and bounded retries; browser tests distinguish empty/running/unsupported/sign-in/course-failure/Discord/storage-API failure. Real denied/layout wording remains live acceptance. |
| Versioned state/migrations preserve originals on failure | V | Full state/recovery/write-failure tests |

## UI, diagnostics and security (§12–15)

| Requirement | Status | Artifact / evidence |
| --- | --- | --- |
| Popup leads with next task; full dashboard/settings/diagnostics | V | Real-script browser UI tests |
| No dependency-heavy UI; pagination and bounded DOM/logs | V | 25-row views, system CSS; runtime-only package |
| Honest empty/error/stale states, no “no homework” from failure | V | Coverage/error copy and partial-scan tests |
| Semantic labels, focus, live status, keyboard navigation | V/L | Actual-input labels, summary keyboard toggle, visible focus, polite status and focus restoration after task save tested. Full assistive-technology/native UX acceptance remains L; not a WCAG certification. |
| Dark/light, zoom/narrow width, clipboard fallback | V/L | Dashboard/popup light/dark computed styles, 320px + 200% text sizing without horizontal overflow, reduced-motion no-animation and selectable redacted clipboard-denial fallback tested. Native browser zoom/screen-reader/manual visual acceptance remains L. |
| Secret masking/reveal and destructive-action separation | V | Explicit entered-replacement reveal/remask, never exposing the stored webhook; refresh remasks. Browser tests verify it and existing destructive-action confirmations/separation. |
| Version/build mismatch detection and reload instruction | V | `version.test.js`, real content-version browser tests, dashboard/popup warnings |
| Structured normal/verbose/redacted support diagnostics | V | Bounded report/schema, redacted copy tests |
| Automatic verbose expiry | V | One-hour session, no extension from unrelated saves, restart/legacy expiry, report clearing and late verbose-response stripping; `state.test.js` |
| Host/permission minimization, no broad cookies/downloads/native messaging | V | Manifest, Firefox lint 0 warnings/errors |
| Validate messages/schemas/origin/job nonce; render text safely | V | Version, storage, background and XSS fixture tests |
| No arbitrary links fetched/executed; no telemetry or exported auth | V | Collector/delivery boundaries, package allowlist/privacy tests |
| Optional AI disabled/unconfigured; no unapproved provider or key | O | P3 explicitly optional; deterministic planner works without it |

## Testing, releases and live definition of done (§17–22)

| Requirement | Status | Artifact / evidence |
| --- | --- | --- |
| Parser/date/state/scan/delivery/UI failure regressions | V/L | 97 Node, 28 Chromium browser and 3 packaging tests pass, including provisional records and aggregate catch-up. Actual school layouts, native full workflow and real Discord/sleep behavior remain live acceptance. |
| Never require school login in automated tests | V | Local fixtures/mocks, isolated native profile |
| Native Zen temporary install | V | `tools/native_smoke.py`; Zen 1.24b temporary install confirmed |
| Full native API/CSP/dashboard workflow | L | Installation alone is not this evidence |
| Real school-layout/course/status/quiet-hour/Discord acceptance | L | RELEASE.md unchecked live checklist; no credentials requested/exported |
| Reproducible runtime-only ZIP, no tests/secrets, content stamp | V | `tools/package_test.py`, ZIP integrity/syntax validation |
| Changelog and supported-layout/limitation guide | V | `CHANGELOG.md`, README, RELEASE and implementation audit describe 0.7.0 evidence, supported fixture scope, remaining gaps and live limitations |
| Permanent signed distribution without security weakening | L/O | Unsigned development ZIP only; Mozilla signing requires user-controlled account/action |
| Native CPU/RAM with student's workload | L | No inferred claim from fixture timings/rounded JS heap |
| Live day-to-day readiness (§22) | L | Do not close goal as complete while required live acceptance remains unknown |
| MCP, Google API/OAuth, bot commands, downloads, other LMS, analytics | N | Explicit §20 non-goals; intentionally absent |

## Audit use

Update P rows only after the named code and tests exist. Preserve L rows until the
student verifies them in the approved live session. Optional P3 work is not a
reason to add a provider, credentials, server or permissions without a concrete
request. Synthetic fixtures and a successful package install never certify the
school account or all Classroom layouts.
