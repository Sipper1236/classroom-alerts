# Changelog

## 0.8.0 — 2026-11-06 (unsigned development release)

- Separate read-only provisional summaries from visible assignment cards lacking stable links; no invented task identity or title-based merging.
- Scoped bounded storage, explicit unverified labels/course links, pagination and confirmed clearing; no planner/Discord/CSV sharing.
- JSON export/import with validation, count preview and per-scope conflict policy. Unknown empty/truncated scans retain prior snapshots; unresolved cards prevent full-course coverage claims.
- Aggregate current-state catch-up after scheduling gaps, no stale-window replay, bounded overflow summary, success-only child acknowledgements, safe retry/restart/in-flight handling and a destination-wide rate-limit checkpoint.
- Current evidence: 97 Node tests, 28 Chromium browser tests and 3 packaging tests; reproducible 13-file ZIP, packaged integrity/syntax/stamp checks and clean Firefox lint. Isolated native temporary installation passed on a standalone retry after an initial smoke timeout.
- Live Classroom/Discord and full native workflow/performance acceptance remain unverified; no roadmap-complete claim.

## 0.7.0 — 2026-11-06 (unsigned development release)

- Count-only daily stale-scan alerts, configurable threshold and quiet-hour/restart handling.
- Current-course controls and per-course attempt/success/detail counters.
- Conservative capped read-only expansion, bounded mutation settling and explicit empty-Classwork markers.
- One-hour verbose diagnostic sessions, automatic expiry and late-response privacy filtering.
- Exact local Discord text previews without sends or queue changes.
- Scoped absence annotations that retain records and never imply completion/deletion.
- School-day pins, chosen-time snooze/clear, course/deadline/missing/review/today filters.
- Keyboard-focus preservation, summary focus, narrow/text-zoom reflow, redacted clipboard fallback, replacement-webhook reveal and clearer empty/error states.

Evidence: 83 Node tests, 25 Chromium browser tests, 3 packaging tests; packaged syntax/integrity checks; Firefox lint 0 errors/notices/warnings; isolated Zen temporary installation.

Still incomplete: provisional summaries without stable item links, aggregate sleep catch-up, native full workflow/performance and live-account/Discord acceptance. No signed permanent distribution, AI provider, external-service crawler, automatic downloads or school mutation is added. See `ROADMAP-CHECKLIST.md` and `RELEASE.md`.

## 0.6.0 — 2026-11-06 (preserved development artifact)

- Local academic snapshots and bounded grade history; opt-in collection/privacy gates.
- Stale/mixed content-script handshake rejection with reload guidance.
- Reproducible 13-file runtime-only packaging and isolated native installation smoke.
- Earlier state, scanning, local planning, durable Discord delivery and dashboard foundation.

The 0.6.0 archive remains separate; its acceptance evidence does not automatically certify later releases.
