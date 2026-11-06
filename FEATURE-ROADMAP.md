# Classroom Assignment Alerts: Detailed Product and Engineering Roadmap

**Written:** 2026-11-05  
**Target platform:** Zen Browser, using Firefox-compatible extension APIs  
**Current prototype:** 0.2.0  
**Primary notification destination:** a private Discord channel  
**Primary purpose:** turn the student's Google Classroom workload into a reliable answer to “What should I work on next?”

> This is a proposed specification, not a claim that these capabilities already exist. It does not authorize implementation, account actions, external data sharing, or installation of other software. The present extension remains a small, partially tested prototype.

## Contents

1. [Product objective](#1-product-objective)
2. [Constraints and boundaries](#2-constraints-and-boundaries)
3. [Current implementation and known failures](#3-current-implementation-and-known-failures)
4. [Reference projects and reusable ideas](#4-reference-projects-and-reusable-ideas)
5. [Priority definitions](#5-priority-definitions)
6. [Cross-course discovery and scanning](#6-cross-course-discovery-and-scanning)
7. [Classroom information coverage](#7-classroom-information-coverage)
8. [Extraction and date correctness](#8-extraction-and-date-correctness)
9. [Local records, identity, and change tracking](#9-local-records-identity-and-change-tracking)
10. [Work recommendations and planning](#10-work-recommendations-and-planning)
11. [Discord delivery and reminder behavior](#11-discord-delivery-and-reminder-behavior)
12. [Optional AI assistance](#12-optional-ai-assistance)
13. [UI cleanup and interaction design](#13-ui-cleanup-and-interaction-design)
14. [Verbose debugging and support workflow](#14-verbose-debugging-and-support-workflow)
15. [Security, privacy, and permissions](#15-security-privacy-and-permissions)
16. [Reliability and scheduling](#16-reliability-and-scheduling)
17. [Testing and acceptance criteria](#17-testing-and-acceptance-criteria)
18. [Installation and releases](#18-installation-and-releases)
19. [Implementation sequence](#19-implementation-sequence)
20. [Deferred features and non-goals](#20-deferred-features-and-non-goals)
21. [Open decisions](#21-open-decisions)
22. [End-to-end definition of done](#22-end-to-end-definition-of-done)

## 1. Product objective

### 1.1 The actual problem

The student should not have to manually open every course, remember every assignment, check several different submission states, and repeatedly decide which task deserves attention. The app should collect permitted, student-visible Classroom information and present a clear, trustworthy workload summary.

The extension should answer:

- What unfinished work is due next?
- Which assignments are already late or explicitly marked missing?
- What changed since the last successful scan?
- Which courses were checked successfully, and which could not be checked?
- What should I start if I have 20, 45, or 90 minutes?
- Am I looking at a complete course scan or only a partial snapshot?
- Is this task truly submitted, or did I only mark it complete in my local planner?

### 1.2 Smallest useful finished version

The first dependable version should:

1. Discover selected enrolled courses through the signed-in Classroom UI.
2. Visit relevant course and assignment pages without taking over the student's active tab.
3. Extract assignment identity, course, title, link, visible due date, and available submission state.
4. Store those records locally with source and freshness information.
5. Display a sorted unfinished-work queue with understandable priority explanations.
6. Send a daily Discord digest and carefully deduplicated due-soon reminders.
7. Explain scan failures in the UI and provide a redacted diagnostic report.
8. Continue safely after browser restarts, navigation failures, or temporary Discord errors.

This version does not require an LLM, a hosted backend, a Google API project, an MCP server, or a distributed analytics pipeline.

### 1.3 What success looks like

After setup, the student can open the extension and see a statement such as:

> Checked 10 of 12 selected courses at 4:05 PM. Two courses need attention. You have three unfinished assignments due within 48 hours. Start with the mathematics practice because it is due first; its submission state was last checked today.

The numbers above are illustrative, not current account data. The product must never manufacture this confidence when scanning failed.

## 2. Constraints and boundaries

### 2.1 Authentication

- Use the student's ordinary signed-in Zen session.
- Do not use Google OAuth or the Google Classroom API for this implementation.
- Do not request, store, prefill, export, or transmit a Google password.
- Do not export Google cookies into a file or copy browser authentication state to an external process.
- If Google requests authentication, stop the scan and ask the student to sign in normally.
- Never attempt to bypass access denials, age restrictions, permission checks, or school controls.
- The user has stated that browser-based access is approved. The implementation must remain within the scope of that approval; additional data sharing may require separate approval.

### 2.2 Browser-based means visible UI data

Read information available through normal Classroom pages. Do not rely on undocumented internal Google RPC endpoints, scraped request tokens, reverse-engineered private APIs, or privileged browser profile access.

“Everything visible” means a defined inventory of relevant academic information, not an unrestricted copy of all text, names, comments, and account details on every screen.

### 2.3 Read-only behavior

The scanner may navigate pages, scroll loaded content, and expand known read-only sections. It must not:

- Submit an assignment.
- Click **Mark as done**, **Unsubmit**, or an equivalent action.
- Post a class comment or private comment.
- Change class enrollment.
- Create, edit, or delete Classroom content.
- Open menus and blindly click controls based on approximate wording.

Local actions such as snoozing a reminder or marking a task “worked on” must never be confused with changes in Classroom.

### 2.4 Runtime limitations

A browser extension cannot run when Zen is completely closed or the computer is off. Browser suspension, discarded tabs, network failures, and expired sessions also limit scanning. The UI must disclose these limitations rather than promise always-on monitoring.

Discord webhooks are an external API, but they are not Google Classroom API access. A future AI key would likewise authenticate only to the chosen AI provider; it would not grant Classroom access.

## 3. Current implementation and known failures

### 3.1 Existing files

| File | Current responsibility | Main gap |
| --- | --- | --- |
| `manifest.json` | Zen/Firefox manifest, permissions, script registration | Temporary-test setup; persistent packaging and permission review remain |
| `assignment-parser.js` | Text parsing for detail, Upcoming, and Due soon layouts | English-specific heuristics, incomplete layout coverage |
| `content.js` | Scan current rendered document and build diagnostics | No cross-course orchestration or authoritative assignment discovery |
| `background.js` | Send newly found items to Discord | No durable assignment store, delivery queue, retry policy, or scheduler |
| `popup.html` | Webhook field, buttons, status, raw debug output | No workload dashboard, styling, settings separation, or accessible layout |
| `popup.js` | Save webhook and request a page scan | Incomplete error reporting and no detailed scan/delivery lifecycle |
| `assignment-parser.test.js` | Basic parser assertions | Synthetic fixtures do not yet cover full live-page behavior |
| `README.md` | Temporary installation and limitations | Needs a real user guide after core behavior is complete |

### 3.2 Failures observed from actual user reports

#### Assignment details

The “Logarithm Practice” detail page contained an assignment title, a due date, and **Assigned** state, but reported zero `[role="listitem"]` and zero `[role="heading"]` elements. The initial selector assumed those elements existed, so it missed data that was plainly visible.

**Lesson:** document structure must be observed, not guessed. A successful page load does not imply a successful parse.

#### Course stream

The mathematics course page had three list items, but they were the **Stream**, **Classwork**, and **People** navigation tabs, not assignment cards. Its Upcoming area exposed “Due Monday 9:02 AM – Logarithm Practice.”

**Lesson:** matching a generic role is insufficient. Candidates need route, region, link, and field evidence.

#### Home Due soon section

The home page exposed two due-soon items in text, but a later scan reported only one. The current parser expects a following `assignment` token to terminate a title. The final card can instead be followed by **Class learning tools**, so a synthetic fixture with an added trailing `assignment` token does not reproduce the reported page.

**Lesson:** the final item in a section needs an explicit boundary strategy. Passing a modified example is not proof that the original live layout works. Exact, sanitized reproductions must be used for regression tests.

### 3.3 Current correctness hazards

- All detected assignments currently receive the current page URL, which can be a course or home URL rather than the assignment permalink.
- The deduplication key includes title, raw due text, and page URL. The same assignment can generate duplicates across layouts or after a rename.
- The scanner excludes assignments with no recognized due date even when they are valid unfinished tasks.
- The detail-page fallback searches broad body text, so unrelated text can be confused with assignment status.
- Whole-page whitespace normalization erases structural boundaries and makes regex parsing ambiguous.
- Due dates are raw strings, not trustworthy timezone-aware values.
- There is no central store of actual assignments, just a bounded list of sent keys.
- Discord failures throw errors but are not clearly surfaced in the popup.
- A successful scan response does not mean the message was delivered.
- Messages are not split for Discord's content-size limit.
- Reminder scheduling, grade extraction, and all-course crawling have not been implemented.
- Current debugging prints snippets of school content to the page console without a debug-mode switch.
- No full live-browser integration test or delivery verification has been completed.

## 4. Reference projects and reusable ideas

### 4.1 How to interpret these references

The source list is `../classroom.txt`. It contains 14 lines but 13 unique repositories. It also contains stray control characters and a duplicated MCP URL on one line. The links below are normalized for readability; the original list is not modified by this document.

References are drawn from repository descriptions, README material reviewed earlier in this task, and the limited source inspection described in the conversation. They are not claims that every advertised feature works today. Source code, dependency safety, current maintenance status, and compatibility require independent verification before reuse.

Feature inspiration does not imply permission to copy implementation code. Check the actual current license before importing anything.

### 4.2 Repository-by-repository feature mapping

#### A. Python-Google-Classroom-Automation

**Reference:** <https://github.com/cop6567/Python-Google-Classroom-Automation>

**Documented concept:** Selenium-based retrieval of assignments through browser automation.

**Useful idea:** browser-driven collection is possible without building the student experience around an API client. Separate navigation from extraction so each can be tested.

**Do not adopt:** asking the user to put a Google email and password into script variables, storing login secrets, or relying on fragile sign-in automation. The extension should reuse the normal browser session instead.

**Roadmap connection:** cross-course navigation, bounded waits, page-state detection, and extraction adapters.

#### B. SaahilNotSahil/google-classroom-scraper

**Reference:** <https://github.com/SaahilNotSahil/google-classroom-scraper>

**Documented concept:** automatically download Classroom materials; the repository includes Python dependency files and a Dockerfile.

**Useful idea:** class materials should be discoverable and organized rather than scattered across unrelated posts.

**Caution:** the sparse README does not establish a robust scan or download workflow. Do not infer complete coverage or safe credentials handling from its description.

**Roadmap connection:** attachment metadata and optional material export, after assignment alerts are reliable. Do not introduce Docker or a Python service just because this project uses them.

#### C. mikecutillo/classroom-scraper

**Reference:** <https://github.com/mikecutillo/classroom-scraper>

**Documented concept:** aggregate assignments, due dates, submissions, and grades; detect missing work and grade changes; send Discord alerts; synchronize to Notion.

**Useful ideas:** one workload view across courses, state-change detection, missing-work alerts, and readable Discord summaries.

**Important limitation:** the public repository describes the system, but explicitly says the running code is private. It is architectural inspiration, not a public implementation to install or copy.

**Do not adopt:** its OAuth/API path for this project. Multi-student household aggregation and Notion synchronization are not necessary for the first student-focused release.

#### D. parkdan26/Google-Classroom-Scraper

**Reference:** <https://github.com/parkdan26/Google-Classroom-Scraper>

**Documented concept:** Apps Script collection of student and assignment-submission information.

**Useful idea:** submission state is a first-class part of workload tracking, not an optional decoration on a title and date.

**Do not adopt:** teacher-oriented roster harvesting, Apps Script/API dependencies, or collection of classmates' personal information. Track only the student's own visible work status where available.

#### E. yash-clouded/classroom_notes_scraper

**Reference:** <https://github.com/yash-clouded/classroom_notes_scraper>

**Documented concepts:** handle lazy loading, expand classwork items, collect material links, deduplicate, select subsets, and retry failures.

**Useful ideas:** bounded scroll-and-rescan, explicit expansion of safe sections, user selection, and a retry list.

**Caution:** opening links in new windows is not a reliable download-success check. The extension must distinguish attempted, accepted, and verified results. Avoid generic “click every list item” behavior because those items may be navigation or controls.

**Roadmap connection:** course-content coverage, stop conditions, attachment inventories, retryable per-page scan failures, and visible progress.

#### F. Deadline-resp-Tracker-AI

**Reference:** <https://github.com/AstralBeneathSilver/Deadline-resp-Tracker-AI>

**Advertised concepts:** Gemini Vision deadline extraction from uploaded documents, deadline questions, chronological organization, and Telegram summaries.

**Useful product idea only:** an optional future document-to-task workflow where the student reviews extracted dates before adding them to the planner.

**Serious caution:** the reviewed repository directed users to an external executable download, a password-protected archive, and administrator execution. These are concerning distribution patterns; no binary provenance or safety has been established. Do not download, execute, recommend, or integrate that loader. Do not treat popularity badges as verification.

**Roadmap connection:** optional reviewed deadline suggestions, not a dependency or installation recommendation.

#### G. discord-google-classroom

**Reference:** <https://github.com/jozsefsallai/discord-google-classroom>

**Documented concepts:** periodic checks for new announcements, optional coursework alerts, configurable interval/timezone, optional attachments, and selected-course notifications.

**Useful ideas:** notification settings, new-versus-old detection, course filtering, time-aware delivery, and separation of collection from messaging.

**Do not adopt:** the Google OAuth/API dependency for the scanner. A Discord webhook is enough for one-way alerts; a full Discord bot and public callback server are unnecessary initially.

**Caution:** attachment forwarding can disclose school material to a third-party platform. Keep it off by default and out of the initial scope.

#### H. classroom-cli

**Reference:** <https://github.com/conorthedev/classroom-cli>

**Documented concept:** interact with Classroom from a Python terminal program using Google API credentials.

**Useful idea:** provide a clear, inspectable representation of courses and assignments. A diagnostic JSON export can offer similar transparency without requiring a CLI.

**Do not adopt:** a separate Python runtime or API-based authentication just to display assignments.

#### I. Singularity

**Reference:** <https://github.com/amolvenkataraman/singularity>

**Documented concepts:** local course backups, announcements and content export, interruption recovery, and a list of unsuccessful downloads; supports Classroom and Brightspace.

**Useful ideas:** resumable work, explicit failure manifests, organized exports, and a clear distinction between complete and incomplete collection.

**Do not adopt:** Brightspace support, bulk video downloads, or cookie export. Those do not solve the current assignment-alert problem.

**Roadmap connection:** resumable course scans, failed-page retry, readable local backups, and honest coverage indicators.

#### J. ClassFetch

**Reference:** <https://github.com/deeptejd/classfetch>

**Documented concepts:** Firefox-compatible extension, checkboxes for available Drive attachments, selected/all downloads, a simple popup, and store distribution.

**Useful ideas:** a compact focused extension UI, explicit item selection, clear unsupported-file notices, and recognizable installation instructions.

**Caution:** rendered-only attachment discovery is not full-course discovery. Download restrictions still apply. A downloaded HTML error page must never be called a successful file download.

**Roadmap connection:** clean popup UX, optional attachment inventory, and browser-store release practices.

#### K. Google Classroom MCP Server

**Reference:** <https://github.com/faizan45640/google-classroom-mcp-server>

**Documented concepts:** separate access to courses, course details/announcements, and assignments/submissions.

**Useful idea:** keep these data categories separate internally, so a course record is not confused with an announcement or assignment.

**Explicitly out of scope:** MCP integration and Google API authentication. The user has requested a standalone application experience with messaging alerts, not an MCP connection.

#### L. sauriol/Classroom-Downloader

**Reference:** <https://github.com/sauriol/Classroom-Downloader>

**Documented concept:** download assignment submissions through Classroom and Drive APIs, with organization by student and export-related options.

**Useful idea:** preserve a relationship between a task and its associated files, and make export outcomes explicit.

**Do not adopt:** teacher-wide submission collection, classmates' files, or Google API dependencies. Student alerting does not require downloading all submissions.

#### M. Classroom Quick Downloader

**Reference:** <https://github.com/adhamhaithameid/Classroom-Quick-Downloader>

**Documented concepts:** cross-browser UI, download retries/timeouts, multi-account handling, local activity statistics, privacy documentation, testing, and operational telemetry.

**Useful ideas:** every operation reaches a clear outcome, multi-account mistakes are treated seriously, and users receive readable success/failure states rather than silent exceptions.

**Licensing warning:** the reviewed README describes a proprietary/source-available license restricting modification and redistribution. Do not copy source into this extension without an applicable license or explicit permission. Independent implementation of general product ideas is the intended approach.

**Do not adopt:** distributed telemetry infrastructure, cloud analytics, or a large backend for this small local-first app. Strong diagnostics do not require collecting usage data remotely.

### 4.3 Consolidated inspiration map

| Proposed feature | Reference inspiration | Planned adaptation |
| --- | --- | --- |
| Cross-course workload dashboard | mikecutillo overview | One student, selected courses, local storage |
| Notification preferences and polling | Discord notifier | Browser scheduler and webhook delivery |
| Lazy-loaded content handling | classroom_notes_scraper | Safe bounded scroll/expand with scan evidence |
| Resumable scans | Singularity | Per-course checkpoints, not file-download machinery |
| Focused browser UI | ClassFetch | Work queue and scan status instead of only downloads |
| Explicit failure outcomes | Quick Downloader | Local job and delivery states without cloud telemetry |
| Submission-aware recommendations | Apps Script scraper and MCP project | Read the student's visible state through the UI |
| Optional document deadline suggestions | Deadline Tracker concept | User-reviewed text/image input, no executable loader |
| Organized exports | Singularity and Classroom-Downloader | Assignment JSON/CSV first, attachments later |

## 5. Priority definitions

- **P0 — correctness, privacy, and trust:** data integrity, no secret leaks, accurate states, and no dangerous browser actions. Release blockers.
- **P1 — core product:** all-course scanning, a usable task queue, scheduled reminders, delivery visibility, and a clean basic UI.
- **P2 — useful expansion:** announcements, materials, visible grade changes, richer planning, and local exports.
- **P3 — optional:** AI explanations, calendar export, reviewed document extraction, and additional messaging destinations.

Implement P0/P1 before building attractive but unreliable extra features. A beautiful dashboard with silently missing assignments is not a successful release.

## 6. Cross-course discovery and scanning

### 6.1 Account and course discovery — P0/P1

The home page and enrolled-course navigation contain course links. Extract links, not just flattened text labels. Normalize them into canonical course records and show a selection screen.

Requirements:

- Keep discovery within the currently selected Classroom account context.
- Do not hard-code `/u/0/`; the reported account uses `/u/1/`.
- Treat `/u/N/` as a routing position, not a durable identity, because account order may change.
- Bind stored datasets to a user-confirmed local profile; if account identity is ambiguous, stop and ask rather than mix records.
- Display each discovered course with a readable name, inclusion toggle, and last scan state.
- Default to enrolled active courses. Archived courses are opt-in.
- Ignore duplicate links in the sidebar and home cards.
- Explain when discovery is incomplete, permission-denied, or based only on sidebar links.
- Make “Discover courses again” available without erasing local preferences.

**Acceptance:** a home page with repeated sidebar and card links produces one record per selected course, under the correct local account profile.

### 6.2 Dedicated scanner tab — P1

Use one extension-owned inactive tab, or a deliberately selected scanner tab, to visit course pages serially. Do not repeatedly redirect the student's active homework tab.

Required scan flow:

1. Confirm the expected account context.
2. Discover or load the selected course list.
3. Visit the first course's Classwork page using observed UI links.
4. Wait for content readiness, not just `document.readyState`.
5. Collect visible assignment links and safe content summaries.
6. Scroll or expand known read-only sections with bounded waits.
7. Visit assignment details when required fields are absent.
8. Record success, partial success, login required, or failure.
9. Continue with the next selected course.
10. Persist results before generating recommendations and alerts.

Avoid fabricating undocumented route formats when the UI already exposes links. Never follow arbitrary external attachment links as part of course navigation.

### 6.3 Coverage and freshness — P0

Each scan needs an honest scope label:

- **Current page only:** no course traversal occurred.
- **Course summary:** Classwork or stream scanned, details not fully visited.
- **Course detail scan:** discovered assignment pages checked within the stated limits.
- **Partial:** some pages failed, content remained unloaded, or the run was cancelled.
- **Complete within configured scope:** all intended pages succeeded, subject to the recorded coverage limits.

Do not equate “two assignments found” with “only two assignments exist.” Home Due soon is a summary, not a complete backlog.

Show the time of the last successful collection separately from the time of the latest attempted collection.

### 6.4 Lazy loading and dynamic navigation — P1

- Wait until the target course/page identity matches the expected scan job.
- Observe meaningful DOM changes with debouncing rather than tight polling loops.
- Stop scrolling after no new relevant records appear over a bounded number of checks.
- Set a maximum page duration and scroll budget.
- Never use an unbounded “scroll until height never changes” algorithm.
- Handle Classroom client-side route changes without requiring a full page reload.
- Detect duplicate script registration after extension reloads and avoid duplicate timers/listeners.
- If a user closes or navigates the scanner tab, stop or requeue safely; do not continue operating on an unrelated page.

### 6.5 Scan controls — P1

Provide **Scan all selected courses**, **Scan this course**, **Scan this page**, **Pause**, **Cancel**, and **Retry failed pages**. The labels must explain their actual scope.

Progress should read “Course 3 of 10: checking assignment details” rather than an invented percentage. Unknown totals should remain unknown.

## 7. Classroom information coverage

### 7.1 Assignments — P0/P1

Capture when visible:

- Stable assignment identity and exact permalink.
- Course identity and display name.
- Title and assignment type.
- Due date/time, original display text, and interpretation confidence.
- Submission state for the current student.
- Instructions, optionally stored in a bounded local field.
- Assigned and achieved points where actually shown.
- Material/link references without automatically opening or downloading them.
- First-seen, last-seen, and last-successfully-checked timestamps.

Tasks with no due date must remain in the inventory under **No due date**, not disappear because the parser requires a date.

Tasks with unrecognized date text must remain visible under **Date needs review**. Unknown data is not a reason to discard a task.

### 7.2 Submission status — P0

Use a normalized status vocabulary while retaining the source wording:

- Unknown.
- Assigned/not submitted.
- Explicitly missing.
- Submitted/turned in.
- Returned.
- Other visible state requiring review.

Do not infer that **Returned** always means no action remains. A returned task can still need corrections. Do not infer that **Assigned** means overdue. Keep teacher state, due-date interpretation, and local planning state separate.

Local states can include **Not started**, **In progress**, **Worked on today**, **Snoozed**, and **Locally complete**. Label them clearly as local and never click Classroom submission controls.

### 7.3 Announcements and stream posts — P2

Capture course, post link, author only if necessary for display, timestamp, and bounded text. Detect new announcements separately from assignments.

Students should be able to choose announcement alerts by course. Do not forward entire discussion threads, private comments, or classmates' names by default. If a post contains an apparent deadline change, flag it as a suggestion for review; do not silently rewrite an assignment's canonical deadline.

### 7.4 Materials and attachments — P2

Initially show file names, file types when visible, and links associated with each assignment or material post. Avoid automatic downloads.

An optional later downloader should include selection, duplicate detection, clear failure states, and respect for access restrictions. Google Docs/Slides export and external service downloads need distinct support; a Drive URL is not automatically a direct downloadable file.

### 7.5 Grades — P2, explicitly opt-in

Only collect grades visible to the current student. Do not attempt teacher-gradebook or roster access. Store grade history locally only when enabled.

Grade notifications must be separate from general task messages and off by default. Discord summaries should omit grades unless the student explicitly chooses to send them.

Never calculate an “official course grade” from incomplete assignment points or guessed weighting. Any optional local estimate must disclose the formula, missing data, and limitations.

## 8. Extraction and date correctness

### 8.1 Prefer structured evidence over broad regexes — P0

For each supported page layout:

1. Detect page type from the route and meaningful page content.
2. Find the academic content region, excluding account/sidebar/navigation text.
3. Locate actual assignment links or bounded cards.
4. Read adjacent title/date/status fields.
5. Record the extraction method and confidence.
6. Fall back to bounded text parsing only if the structured method fails.

Use native headings as well as ARIA headings where appropriate. Generic list items, whole-body status searches, and card titles terminated by a token from the next card are not sufficient.

### 8.2 Last-card and summary boundaries — P0

The reported home-page failure must become a regression case with the original transition:

```text
Thu, Nov 12, 11:59 PM SMU Library Visit Class learning tools
```

Do not append a fake `assignment` delimiter in the test. The parser must handle the actual section boundary or use the card's DOM container to avoid guessing a text boundary.

Include first-card, middle-card, final-card, single-card, and empty-section fixtures. Section labels must not become part of assignment titles.

### 8.3 Due-date handling — P0

Support observed English layouts first, and visibly report unsupported formats rather than inventing a date. Required cases include:

- Explicit month/day/time.
- Dates with a year.
- Date-only values.
- Weekday and time summaries such as “Monday 9:02 AM.”
- “Today” and “Tomorrow,” when actually observed and bounded by known UI context.
- No due date.
- Ambiguous numeric formats and unsupported languages.

Store raw display text and normalized output separately. For date-only deadlines, keep date-only semantics; do not silently manufacture 11:59 PM. For missing years, use documented inference rules and mark the inferred year. Treat ambiguous weekday summaries as lower-confidence until a detail page confirms them.

Do not automatically roll an apparently past weekday into next week and thereby hide overdue work. Account for school timezone, browser timezone, year rollover, daylight-saving transitions, and travel between timezones.

### 8.4 Date confidence and UI behavior

Suggested labels:

- **Confirmed:** detail page exposes enough information to determine the deadline.
- **Inferred:** a missing year or relative date was resolved with documented rules.
- **Summary only:** deadline comes from a home/course summary.
- **Ambiguous:** more than one interpretation is plausible.
- **Unknown:** no usable deadline found.

Exact-time reminders should not be scheduled from ambiguous dates. Show a review prompt or use a coarse digest entry instead.

## 9. Local records, identity, and change tracking

### 9.1 Assignment identity — P0

Use account profile + course ID + assignment ID, extracted from observed assignment links where possible. Titles, due text, and current page URL are mutable attributes, not identity.

If a summary has no stable link, mark it provisional. Merge it with a detail record only when evidence is sufficiently strong; same-title tasks in different courses must remain distinct.

### 9.2 Minimum practical record

The following is an illustrative schema, not a requirement to build a generic data framework:

```json
{
  "schemaVersion": 1,
  "localProfileId": "school-profile",
  "courseId": "observed-course-id",
  "assignmentId": "observed-assignment-id",
  "title": "Example assignment",
  "url": "https://classroom.google.com/.../details",
  "due": {
    "raw": "Nov 9, 9:02 AM",
    "date": "2026-11-09",
    "time": "09:02",
    "timezone": "user-confirmed-school-timezone",
    "confidence": "inferred"
  },
  "classroomStatus": "assigned",
  "localStatus": "not-started",
  "firstSeenAt": "2026-11-05T23:00:00Z",
  "lastSeenAt": "2026-11-05T23:05:00Z",
  "lastVerifiedAt": "2026-11-05T23:05:00Z",
  "source": "assignment-detail",
  "coverage": "detail"
}
```

Keep fields only when they have a concrete consumer. Start with `browser.storage.local`; introduce IndexedDB only if actual volume and query needs justify it.

### 9.3 Changes and deduplication — P0/P1

Detect independently:

- Newly discovered assignment.
- Title changed.
- Due date changed.
- Submission state changed.
- Newly visible grade, if enabled.
- Item no longer visible after a successful bounded scan.

Never mark a task deleted or complete because a partial scan omitted it. A failed page must not erase previously known work.

Notification identity should include assignment identity, event type, and relevant revision/reminder window. A deadline change should produce one meaningful update, not a brand-new task plus duplicate reminders.

### 9.4 Local edits, backup, and deletion — P1/P2

Preserve local notes, effort estimates, and snoozes across rescans. Provide an export without webhook URLs or AI keys. Imports need schema validation and conflict handling.

Provide **Clear diagnostics**, **Clear assignment history**, and **Reset all local data** as distinct actions. Destructive actions need confirmation and a concise statement of what will be removed.

## 10. Work recommendations and planning

### 10.1 Deterministic recommendations first — P1

The app should be useful without an AI key. Build a transparent priority queue using reliable local facts:

1. Exclude or separately display tasks confirmed submitted, subject to user preferences.
2. Surface explicitly missing tasks and confirmed overdue unfinished work.
3. Order near-term deadlines before distant work.
4. Include effort estimates only when the user supplied or confirmed them.
5. Respect snooze preferences without pretending the deadline changed.
6. Keep no-date and ambiguous-date tasks visible in a separate review/backlog group.

Overdue work does not automatically outrank every imminent task forever. Give the student a clear explanation and a way to deprioritize work that is no longer actionable.

### 10.2 Explain every suggestion

Each recommended task should show a short rationale such as:

> Due tomorrow; still shown as Assigned; estimated 30 minutes; last verified 12 minutes ago.

Unknown effort should read **Effort not estimated**, not a confident fabricated number. Unverified status should reduce certainty and display a warning.

### 10.3 “I have this much time” — P2

Offer a small time-budget control rather than a complicated calendar engine. Suggest tasks or manageable next steps that fit the chosen time, based on user-confirmed estimates.

For an unestimated task, suggest “Open the instructions and estimate effort” instead of claiming it will fit. Allow a user note such as “Do questions 1–5 first.”

### 10.4 Local planning controls — P1/P2

- Set an effort estimate.
- Add a next-action note.
- Mark local progress.
- Snooze alerts until a specific time.
- Pin a task for today's plan.
- Hide a course from planning without deleting its history.

Do not add complex project-management features before the basic workload list and reminders are trustworthy.

## 11. Discord delivery and reminder behavior

### 11.1 Webhook setup — P0/P1

Use a private channel by default. Explain that sending a message shares selected school information with Discord and any channel members. Provide a preview of exactly which fields will be sent.

Setup must include **Send test message** with an explicit user action and delivery outcome. Validate the parsed URL's exact hostname, HTTPS scheme, and webhook path; a permissive prefix regex must not accept arbitrary destinations or embedded whitespace.

Never include the webhook URL in a log, exported report, exception message, or screenshot generated by the app.

### 11.2 Event types — P1

- New assignment summary.
- Due-soon reminder at chosen windows.
- Daily unfinished-work digest.
- Deadline changed.
- Missing/overdue summary.
- Scan health warning when collection has been stale for a meaningful period.

Announcement and grade updates are separate opt-in event types, not automatic additions to the basic homework digest.

### 11.3 Message composition

Messages should show course, title, deadline with timezone where relevant, status, rationale, and a direct assignment link. If only a summary-page link is known, label it as a course/home link rather than pretending it opens the assignment.

Example, using illustrative data:

```text
Homework check-in · last checked 4:05 PM

Start here
Mathematics — Example practice
Due tomorrow at 9:00 AM · Not submitted
Why: earliest confirmed deadline among unfinished tasks.

Also coming up
Research — Example library task
Due Thursday · status needs verification

Coverage: 8/9 selected courses checked; 1 needs sign-in.
```

Do not send the full debug report, classmates' details, private comments, or full assignment instructions as part of the normal digest.

### 11.4 Delivery queue and failure handling — P0/P1

- Split or batch messages to remain within Discord's current message limits.
- Escape or safely format user-controlled text.
- Disable automatic mentions using `allowed_mentions`; assignment text containing `@everyone` must not ping a server.
- Persist pending notifications so closing the popup does not cancel delivery state.
- Mark delivered only after a successful HTTP response.
- Respect HTTP 429 retry timing and bounded backoff for transient failures.
- Treat a deleted/invalid webhook as a configuration problem, not an infinite retry loop.
- Show last successful delivery and recent failure reason separately from scan success.
- Serialize overlapping updates to prevent duplicate sends and lost local-state writes.

A crash after Discord accepts a message but before local persistence can still create a duplicate on retry. Document at-least-once behavior and minimize this window rather than claiming perfect exactly-once delivery.

### 11.5 Noise controls — P1

Support quiet hours, a school timezone, per-course inclusion, reminder windows, and a maximum useful notification frequency. Do not send hundreds of “new assignment” messages during first synchronization; provide an initial digest or ask first.

When the computer resumes after sleep, combine missed notifications into a catch-up summary instead of replaying every stale reminder. Submitted work should stop future reminders once that state is verified.

### 11.6 Webhook limitations

An incoming webhook supports one-way posting. It does not by itself support interactive Discord commands, button callbacks, or conversational planning. Those would require additional Discord application infrastructure and are deferred unless explicitly requested.

## 12. Optional AI assistance

### 12.1 Role — P3

AI may summarize instructions, explain a proposed plan, suggest task breakdowns, or answer questions over a selected local workload snapshot. It is not required for collection, reminders, or basic ranking.

Never ask the model to determine deadlines from ambiguous data without exposing uncertainty. Prefer validated structured fields to raw page dumps.

### 12.2 Consent and data minimization — P0 if enabled

- AI is off by default.
- Show the provider and selected model before any request.
- Show which assignment fields are sent.
- Exclude grades, private comments, account details, and full instructions unless separately approved.
- Respect school rules and provider account/age requirements.
- Treat API keys as secrets; extension local storage is not a secure encrypted vault.
- Do not bundle a developer's shared API key or send requests through an undisclosed proxy.
- Avoid arbitrary `<all_urls>` host permission just to support hypothetical providers.

### 12.3 Safety and output verification

Classroom content is untrusted input. Instructions inside a task or linked document must not override the planner's rules, reveal secrets, modify settings, run code, or trigger arbitrary network calls.

Constrain AI outputs to recommendations, validate referenced assignment IDs against the local store, and clearly label generated suggestions. Never let the model submit work, send arbitrary Discord content, or change deadlines autonomously.

Cache summaries by relevant content revision, use explicit cost limits, and keep the deterministic planner available if the key is absent, the quota is exhausted, or the provider fails.

## 13. UI cleanup and interaction design

### 13.1 Main issue with the current popup

The current UI is a password input, three buttons, a status string, and a large raw JSON block. It exposes configuration and developer output before answering the student's main question. It also does not distinguish detection success, coverage, and delivery success.

The cleaned-up interface should lead with **What should I work on?**, not **Paste webhook URL** after setup is complete.

### 13.2 Three surfaces, each with a clear job

**Toolbar popup:** quick workload summary, current scan status, next task, and a scan button.

**Full extension dashboard tab:** complete task list, course coverage, planning controls, and history. Long-running jobs must not depend on the popup staying open.

**Settings/diagnostics page:** notification configuration, course selection, privacy choices, and verbose reports. Keep raw debug output out of the everyday task view.

Start with plain HTML, CSS, and existing extension APIs. No frontend framework or component library is necessary for this size of interface.

### 13.3 Popup wireframe

```text
┌──────────────────────────────────────────┐
│ Classroom Alerts            Settings     │
│ Last verified 8 min ago · 9/10 courses    │
│                                          │
│ Next up                                  │
│ Example mathematics practice             │
│ Mathematics · Due tomorrow, 9:00 AM       │
│ Assigned · effort not estimated          │
│ Why: earliest confirmed deadline         │
│ [Open assignment]                        │
│                                          │
│ 3 due soon · 1 missing · 2 need review    │
│ [Open dashboard]  [Scan all courses]      │
│                                          │
│ Discord: last sent today at 4:00 PM       │
│ One course failed · View details         │
└──────────────────────────────────────────┘
```

No count should include hidden assumptions about failed courses. If the dataset is incomplete, show **At least 3 due soon** or an adjacent coverage warning.

### 13.4 Dashboard sections — P1

- **Today:** next actions and pinned work.
- **Assignments:** sortable/filterable list grouped by deadline or course.
- **Courses:** discovery, selection, and scan health.
- **Activity:** meaningful changes and notification outcomes.
- **Settings:** webhook, schedule, timezone, and data controls.
- **Diagnostics:** structured scan reports, selectors, and redacted export.

These may be simple navigation links or sections rather than a complex router.

### 13.5 Assignment row design

Each row needs title, course, deadline, status, freshness, and an open link. Details can expand to show instructions, source confidence, local notes, and reminder history.

Use status text plus an icon; do not rely on red/yellow/green alone. Avoid displaying long raw URLs. Do not truncate every title so aggressively that tasks become indistinguishable.

### 13.6 Empty and error states — P0/P1

Distinguish these messages:

- No data collected yet.
- Scan in progress.
- No unfinished tasks found within the checked scope.
- No recognized tasks on this page layout.
- Sign-in required.
- Some courses failed.
- Deadline format needs review.
- Discord not configured.
- Discord delivery failed.

“You have no homework” is unacceptable when the scanner found zero candidates on an unsupported layout.

### 13.7 Visual cleanup

- Use a system font and a consistent spacing scale.
- Move inline styles into a small stylesheet.
- Set a sensible popup width with no horizontal overflow at normal browser zoom.
- Support `prefers-color-scheme` for light/dark presentation.
- Use one primary button per state, such as **Scan all courses** or **Retry failed**.
- Keep destructive actions visually distinct and away from routine scan controls.
- Mask secrets by default, with an explicit reveal action.
- Use readable headings, short paragraphs, and compact status badges.
- Avoid decorative animation, excessive gradients, and a dependency-heavy design system.

### 13.8 Accessibility

- Associate every input with a real label.
- Use semantic buttons and links.
- Provide visible keyboard focus.
- Announce scan/delivery updates with a restrained `aria-live` region.
- Make errors understandable without color.
- Keep all functionality keyboard accessible.
- Respect reduced-motion preferences.
- Test at enlarged text size and narrow widths.
- Offer a manual select-and-copy fallback if clipboard access fails.

## 14. Verbose debugging and support workflow

### 14.1 Debugging should answer specific questions

- Did the extension load, and which build is running?
- Is the page script from the same version as the background script?
- Which account context and route were scanned?
- Which layout adapter ran?
- How many candidate cards and assignment links were discovered?
- Why was each candidate rejected?
- Was the last card missed because of a boundary or loading issue?
- Were parsed assignments persisted?
- Was a notification queued, suppressed, or delivered?
- Did a network error occur, and when will it retry?

### 14.2 Structured local report — P0/P1

Include extension version from the manifest, parser version if different, scan ID, scan scope, route category, timestamps, counts, extraction methods, rejection reasons, truncated-sample indicators, and bounded errors.

Examples of explicit rejection reasons:

- `navigation-item-not-assignment`
- `missing-stable-link`
- `title-not-found`
- `due-date-unrecognized`
- `summary-only-record`
- `detail-page-login-required`
- `content-not-loaded-before-timeout`

Unknown deadlines should not reject the entire assignment record; the diagnostic should identify the missing field while keeping the task visible.

### 14.3 Three levels of diagnostic detail

**Normal:** counts, statuses, versions, and error codes; no assignment text dumps.

**Verbose:** bounded card snippets and candidate field evidence, explicitly enabled locally.

**Support export:** redacted report, previewed by the student before copying or saving. Remove webhook URLs, tokens, query strings where unnecessary, names, private comments, grade values, and raw body text by default.

Automatic regex redaction is not perfect. Display a warning and a preview; never guarantee that a raw page excerpt contains no personal information.

### 14.4 Log storage and performance

Use a bounded local ring buffer. Cap text length, event count, and retention. Avoid serializing the whole DOM or saving every scan's full body text.

Do not log secrets through thrown request URLs. Turn verbose logging off after a chosen troubleshooting session or on explicit user action. Never upload logs automatically.

### 14.5 Practical user workflow

1. Reload the temporary extension.
2. Reload the relevant Classroom page so content scripts update.
3. Confirm the popup reports matching build versions.
4. Enable verbose mode and run a page-only scan.
5. Review candidate counts and field-level rejection reasons.
6. Copy a redacted support report.
7. Capture a minimal sanitized fixture that reproduces the failure.
8. Add the fixture as a regression test before changing the parser.
9. Rerun tests and verify the live page with the student.

## 15. Security, privacy, and permissions

### 15.1 Manifest review — P0

The existing Classroom host match covers the whole Classroom origin. More data coverage does not require permission to every website; it requires correct navigation and parsing.

For each permission, document the actual consumer:

| Permission/capability | Intended use | Review requirement |
| --- | --- | --- |
| Classroom host access | Read selected Classroom pages | Keep limited to the needed origin |
| Discord webhook host access | Send configured alerts | Explain external disclosure; exact URL validation |
| Local storage | Preferences, workload state, queue | No claim of encrypted secret storage |
| Tabs access | Identify/navigate scanner tabs | Review whether broader tab metadata access can be reduced |
| Clipboard write | User-requested diagnostic copy | No background clipboard monitoring |
| Alarms, if added | Scan/reminder scheduling | Needed only when scheduling is implemented |

Do not add downloads, cookies, native messaging, `<all_urls>`, or arbitrary AI host permissions preemptively.

### 15.2 Message validation

Background handlers must validate message type, schema, size, originating tab/frame, and expected scan job. Do not trust a message merely because it originated in a content script.

Use explicit request/response types and job IDs. Reject arbitrary URLs and unchecked arrays. Render extracted text with `textContent`, not `innerHTML`.

### 15.3 Network destinations

Classroom navigation stays on validated Classroom URLs under the selected context. Discord sends go only to a validated configured webhook. Optional AI requests go only to an explicitly approved provider after consent.

Do not execute scripts or fetch arbitrary external URLs found in assignment instructions. Linked tools such as Kognity should be presented as links, not automatically scraped with Classroom credentials.

### 15.4 Private information boundaries

- No classmate roster collection.
- No private-comment forwarding by default.
- No grade forwarding by default.
- No remote analytics pipeline.
- No external crash-reporting service without explicit opt-in.
- No exported session cookies.
- No webhook or AI key in backups, support reports, or source control.

## 16. Reliability and scheduling

### 16.1 Central orchestration — P1

The background coordinator should own scan jobs, storage updates, reminder scheduling, and delivery. Content scripts should collect bounded page evidence and return it; the popup should only initiate actions and display state.

Avoid one independently scheduled timer per open Classroom tab. Multiple tabs should not multiply reminder frequency or create conflicting writes.

Use the browser's scheduling facilities for reminders and scans where suitable. Persist enough state to recover after restart, rather than relying on a popup or a single long-lived content-script interval.

### 16.2 Error categories

Separate login required, page denied, network failure, navigation timeout, unsupported layout, parser ambiguity, storage failure, and Discord failure. Each needs a distinct user-facing recovery action.

For example, **Sign in to Classroom** is appropriate for session expiry; **Update scanner / send report** is appropriate for an unknown layout. Retrying every minute indefinitely is not a solution to either.

### 16.3 Scan resource limits

Start with serial navigation, conservative spacing between pages, bounded waits, and a configurable interval with a practical minimum. Avoid scanning every assignment detail every few seconds.

Reuse recently verified records where safe and recheck likely changed or upcoming work first. Record skipped older detail pages in the coverage summary so efficiency does not become hidden incompleteness.

### 16.4 Upgrade and storage migrations

Version the local schema, validate old records, and preserve user preferences when upgrading. An incompatible or corrupt record should generate a recoverable warning, not trigger silent clearing of the entire dataset.

Keep migrations small and tested. Do not build a generic migration framework before there are actual schema changes.

## 17. Testing and acceptance criteria

### 17.1 Parser fixtures — P0

Create sanitized fixtures preserving the original structure, separators, and final-section transitions. The current tests use simplified text and therefore do not establish DOM compatibility.

Required fixtures:

- Assignment detail page with no ARIA headings/list items.
- Stream navigation list items that must not become assignments.
- Course Upcoming summary with a weekday deadline.
- Home Due soon with two items, where the final title is followed by **Class learning tools**.
- A single Due soon card with no next-card delimiter.
- No due-soon items.
- Valid assignment without a due date.
- Unrecognized deadline that remains visible for review.
- Duplicate sidebar/course-card links.
- Same assignment title in two different courses.
- Submitted, assigned, returned, and unknown status regions.
- Unicode punctuation and long titles.
- Instructions containing misleading words such as “Assigned,” “Returned,” or “Due.”

### 17.2 Date tests

Cover year rollover, school/browser timezone differences, DST boundaries, date-only deadlines, weekday summaries, ambiguous numeric formats, and unsupported locales. Use a controlled reference clock; tests must not change outcome depending on the day they run.

### 17.3 Scan integration tests

Use local fixture pages and mocked extension messages where possible. Confirm course discovery, queue progression, cancellation, partial failure, route changes, storage persistence, and recovery.

Never require a real school login in automated tests. Live account checks are a separate user-assisted acceptance step, with no stored passwords or exported cookies.

### 17.4 Discord tests

Mock success, rate limiting, invalid webhook, oversized messages, network timeout, duplicate queue events, browser restart, and mention-containing assignment text.

Verify that failed messages remain queued appropriately, successful messages are not repeatedly resent, retries are bounded, and logs contain no webhook secrets.

### 17.5 UI tests

Check setup, normal workload, partial scan, zero results, unsupported layout, sign-in required, copy failure, keyboard navigation, and dark/light mode. Confirm that closing the popup does not interrupt background work.

### 17.6 Live acceptance checklist

- [ ] Extension loads in the actual installed Zen version.
- [ ] User selects the intended Classroom account context.
- [ ] All selected courses appear once in the course list.
- [ ] Both reported Due soon examples are recognized without invented delimiters.
- [ ] A sample detail page exposes the correct title, due date, and status.
- [ ] An assignment without a due date remains visible.
- [ ] A failed course is shown as failed, not empty.
- [ ] A Discord test message succeeds in the chosen private channel.
- [ ] A repeated scan does not produce duplicate notifications.
- [ ] A deadline change produces one understandable update.
- [ ] A verified submitted task stops applicable future reminders.
- [ ] Quiet hours and timezone settings behave as described.
- [ ] Local notes survive a rescan.
- [ ] Browser restart preserves records and resumes pending work safely.
- [ ] Exported diagnostics omit secrets and default-sensitive fields.
- [ ] No scan clicks submission, comment, enrollment, or edit controls.

## 18. Installation and releases

### 18.1 Temporary development installation

Keep the current `about:debugging` workflow documented. Explain that temporary extensions disappear after a browser restart and that updated content scripts require reloading existing Classroom tabs.

Show a version/build indicator in the popup and report both background/content versions. A mismatch should prompt a page reload rather than masquerade as a parser failure.

### 18.2 Persistent use

Investigate the current Mozilla signing/unlisted-distribution process and Zen compatibility before promising permanent installation. Add a stable Gecko extension identifier where required and preserve data identity across development updates.

Do not instruct users to disable signature verification or weaken browser security as the standard installation method.

### 18.3 Packaging

Package only runtime files and user documentation. Exclude test fixtures, debug exports, keys, webhook URLs, local school content, and development artifacts.

Add a short changelog with clear limitations, supported page layouts, and known regressions. A release should state what was tested in Zen versus only tested with Node fixtures.

## 19. Implementation sequence

### Phase 1 — Make current-page extraction trustworthy

**Priority:** P0.  
**Goal:** correctly detect supported assignments and stop silently discarding the last home card.

- Capture exact sanitized fixtures from reported failures.
- Replace next-card-token parsing with bounded card extraction where possible.
- Preserve no-date and unknown-date tasks.
- Return exact assignment permalinks when visible.
- Add structured rejection reasons and version matching.
- Add clear scan versus delivery status.

**Exit evidence:** fixture regressions pass and the student verifies the reported detail/home/course layouts in Zen. Do not declare completion from synthetic text tests alone.

### Phase 2 — Add local records and deduplication

**Priority:** P0/P1.  
**Goal:** one durable record per real assignment.

- Store courses and assignments locally.
- Replace title/date/page-based keys with stable identity.
- Preserve source confidence, freshness, and local planning fields.
- Detect deadline/status changes.
- Add validated storage updates and import/export boundaries.

**Exit evidence:** the same task scanned from home and detail pages merges correctly; deadline changes do not create a second task; a failed scan does not delete existing data.

### Phase 3 — Scan all selected courses

**Priority:** P1.  
**Goal:** remove the requirement to manually open each course.

- Discover courses through UI links.
- Add explicit account-context confirmation.
- Implement one dedicated scanner tab and a serial navigation queue.
- Add bounded lazy-load handling, cancel/pause, and per-course checkpoints.
- Show exact coverage and retry failures.

**Exit evidence:** a user-assisted run checks the selected course list without redirecting the active homework tab, records partial failures honestly, and resumes safely after cancellation.

### Phase 4 — Deliver useful reminders

**Priority:** P0/P1.  
**Goal:** dependable one-way Discord alerts rather than one-off detection messages.

- Add webhook test, strict validation, mention suppression, and message splitting.
- Persist a queue and handle rate limits/retries.
- Add digest, due-soon windows, quiet hours, and catch-up behavior.
- Base reminders on normalized deadlines and verified statuses.

**Exit evidence:** mocked delivery tests pass and one explicit live Discord test confirms delivery. Repeated scans do not spam the channel.

### Phase 5 — Clean UI and deterministic recommendations

**Priority:** P1.  
**Goal:** answer “what should I work on?” without opening raw JSON.

- Build the compact popup and full workload dashboard.
- Move secrets and verbose diagnostics to separate settings sections.
- Add transparent priority reasons and freshness indicators.
- Add local effort estimates, progress notes, and snoozes.
- Verify accessibility and error states.

**Exit evidence:** the student can identify the next task, inspect uncertainty, launch a scan, and understand delivery status without using developer tools.

### Phase 6 — Broaden academic coverage

**Priority:** P2.  
**Goal:** incorporate announcements, material links, and optional visible grade updates without compromising homework reliability.

- Add separate adapters and consent controls.
- Keep classmates/private comments out of defaults.
- Add change-aware summaries and local export.

**Exit evidence:** each data type has a stated scope, regression fixtures, and separate notification controls. Unknown layouts do not corrupt existing assignment extraction.

### Phase 7 — Optional AI and extra integrations

**Priority:** P3.  
**Goal:** improve explanations only after collection and reminders are trustworthy.

- Add an explicit approved provider/key configuration.
- Minimize outbound data and validate structured suggestions.
- Keep deterministic operation working without AI.
- Consider calendar export or reviewed document extraction only if requested.

**Exit evidence:** the app remains fully useful with AI disabled; outbound requests match user consent; model suggestions cannot change canonical deadlines or invoke arbitrary actions.

## 20. Deferred features and non-goals

Do not build these merely because a reference project contains them:

- MCP integration.
- Google OAuth/API access for this implementation.
- A full Discord bot with interactive commands.
- Parent/household multi-student aggregation.
- Public server, cloud database, or distributed analytics pipeline.
- Teacher roster exports or downloads of other students' submissions.
- Automated homework submission or generated work handed in as the student.
- Bulk download of every course file or video.
- Brightspace or other LMS support.
- Notion synchronization.
- A full calendar scheduler with complex optimization.
- Arbitrary website scraping for external learning services.
- Administrator-level executable installers.
- Remote telemetry or automatic upload of school-page diagnostics.

These may be reconsidered only with a concrete user need, appropriate permission, and evidence that the smaller implementation cannot meet it.

## 21. Open decisions

Before implementing scheduling, release packaging, or optional sharing, confirm:

1. Which courses should be included, and should archived classes ever be scanned?
2. What school timezone should deadlines and quiet hours use?
3. Which reminders are useful: daily digest, 24-hour reminder, same-day reminder, overdue summary?
4. Is the Discord channel private, and are course titles/assignment names permitted to be sent there?
5. Should the app include announcement text or only links?
6. Should grades remain entirely local?
7. How long should assignment history and diagnostics be retained?
8. Is periodic scanning while Zen is open sufficient, or is a separately approved always-on option needed later?
9. Which English/date layouts are actually visible in the student's account?
10. Is persistent extension distribution required for the next usable release?
11. Does the school permit assignment details to be sent to an AI provider, and does the student meet that provider's account requirements?

Do not block basic extraction fixes on optional questions about AI or extra integrations. Resolve decisions when the corresponding phase needs them.

## 22. End-to-end definition of done

The product is ready for everyday use only when all of the following are demonstrated:

- The student can install it with a documented workflow appropriate to the release type.
- It operates in the intended signed-in account without OAuth, exported cookies, or password handling.
- It discovers and scans selected courses through normal permitted UI navigation.
- It retains valid assignments even when due dates are absent or ambiguous.
- It uses stable assignment identity and correct source links.
- It exposes scan coverage, uncertainty, and stale data rather than concealing them.
- It produces a useful, explainable unfinished-work queue without requiring AI.
- It sends the configured Discord reminders, respects quiet hours, and surfaces delivery failures.
- It avoids ordinary duplicate alerts and documents remaining retry-related duplication limits.
- It keeps private fields local by default and never leaks secrets through logs or exports.
- It survives navigation failure, popup closure, browser restart, and temporary network problems without losing records.
- It has regression fixtures for the actual reported Classroom layouts, not only idealized examples.
- It has been verified in the student's real Zen workflow with explicit consent for any external test message.

### Final implementation principle

**Collect accurately, retain evidence, explain uncertainty, and send fewer better alerts.**

Cross-course automation and a clean UI matter, but neither compensates for a parser that silently misses the final assignment or a reminder system that cannot distinguish “nothing due” from “nothing successfully scanned.”
