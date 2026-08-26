# Shipyard board — UI/UX review

Reviewed as a daily user against `docs/DESIGN.md` §UI and `docs/board-mockups.html`
(Option B) (mockup later removed from the repo), driving the demo board (`node scripts/demo.js`, fixture
`test/fixtures/demo-flows.json`) with Playwright/Chromium at 1440px and 640px,
light and dark (`prefers-color-scheme`), keyboard-only, and across live poll
cycles (5s) with mocked data changes. Screenshots for every finding are in
`.superpowers/sdd/uiux-shots/` (numbered, referenced below).

Severity counts: **2 high, 5 medium, 4 low.**

---

## High

**[high] "Needed" merge-gate cards show a nonsensical "now: merge · next: merge" pipeline label** — `public/index.html` `renderPipe()`: when `phase === 'ready-to-merge'` (`idx === 5`), `nextName` falls through to the same segment name because the guard is `idx < 5`. This hits exactly the cards in *Needs you* that are one click from done (screenshots `06`, `20`, `25`, `34`) — the highest-value, most time-sensitive cards on the board — and the label is the first thing "what happens next" scent depends on. Fix: when `idx === 5`, label should read something like `now: ready to merge` (no "next", or "next: —"), matching the spec's own example (`now: qa · next: merge`) which never repeats a segment.

**Triage: fix-now (task/18-uiux-fixes).** `renderPipe()`'s next-stage lookup now
maps `idx === 5` (the last active segment, "merge") to `next: verify` instead of
falling through to `SEGMENTS[idx + 1]` out of range; the terminal cap (idx 6,
merged/verified) already rendered `shipped (${phase})` and was untouched. No
stage is ever repeated. Verified via Playwright against the demo fixture's
ready-to-merge card.

**[high] The drawer's "Status" and "Request" are ordinary tabs, not the always-visible header + request the spec calls for** — DESIGN.md: "status header first ... then the original request verbatim, then tabs: timeline · plan.md · scope.md ...". The implementation (`TABS = ['status','request','timeline',...]`, `renderDrawerBody()` switch) makes Status and Request two of eight equal, mutually-exclusive tabs. Opening any flow shows only Status by default; the original ask — the thing a user most wants when triaging a "needs you" card — is one extra click away and invisible unless you notice the "Request" tab exists (screenshots `06` vs `07`). Fix: render the status block and the request text as fixed content above the tab bar (only Timeline/Plan/Scope/Proof/PR/Git remain tabs), matching both the spec and the stated goal ("easily open the plan/spec ... what it needs").

**Triage: fix-now (task/18-uiux-fixes).** Added a fixed `#drawer-request` block
below `#drawer-status`, both rendered unconditionally by `renderDrawerChrome()`
on every open and every tab switch (stage/status/needed-action/last-event/action
buttons in the status block, the request verbatim below it). `TABS` is now
`['timeline','plan','scope','proof','pr','git']` only. Hash routing is
preserved (`#flow/<id>/<tab>`); `parseHash()` and `openFlow()` fall back to the
default `timeline` tab for any hash value not in the new `TABS` list, so old
`.../status` and `.../request` deep links degrade gracefully instead of
erroring. Verified via Playwright: header/request stay visible while a
non-default tab is active, and an old `status` hash lands on `timeline`.

## Medium

**[med] Per-phase timeline reports are named but not openable** — `renderTimelineTab()` prints `<span class="tl-report">report: reports/qa.md</span>` with no click handler at all (confirmed in source and by testing); the doc content (`reports/qa.md`, fully populated in the fixture) is fetched into the flow object but never reachable from any tab. Screenshot `08`. This directly contradicts the stated need ("easily open ... reports") — the one useful artifact per phase is visible by name only, a dead end. Fix: make `.tl-report` a button that opens a lightweight inline viewer (or reuses the doc-tab markdown renderer) for that specific `rel` path via the existing `/api/doc` endpoint.

**Triage: fix-now (task/18-uiux-fixes).** `.tl-report` is now a real `<button>`
that toggles an inline `<div class="tl-report-body">` beneath the timeline
entry, lazily loading and rendering the report through the same `loadDocContent`
+ `renderMd` path the Plan/Scope/Proof tabs use. Matching switched from
`doc.rel` to `doc.name` (`reports/<phase>.md`) since `rel` now carries the
`.claude/ship/` prefix for real runs (`lib/collectors/ship.js` `listDocs`) while
`name` stays the bare display name in both the fixture and real shapes;
`loadDocContent` now fetches by `doc.rel` (not the bare name) so the same fix
also corrects doc loading for real (non-demo) runs, not just the fixture.
Verified via Playwright: clicking the report control renders its markdown
content inline.

**[med] Per-source health row has zero visual affordance** — `.freshness{background:none;border:none}` with no hover state, icon, chevron, or underline; it reads as plain static text ("refreshed 0s ago") though it's a `<button>` that reveals `git ✓ · gh ✗ · linear ✓` on click (screenshot `05`). Spec explicitly calls this out as something that must be discoverable ("sits behind the freshness indicator"). In daily use this means the one place that explains *why* a source might be stale/wrong (e.g., "gh not authenticated") is invisible unless a user randomly clicks timestamp text. Fix: add a chevron/caret or subtle underline plus a hover state to `.freshness`.

**Triage: fix-now (task/18-uiux-fixes).** `.freshness` now renders as a pill
button with a `▾` chevron that rotates on `aria-expanded`, plus a visible hover
background/border. Verified via Playwright: chevron present, `cursor: pointer`,
`aria-expanded` toggles on click.

**[med] Copy actions are visually indistinguishable from navigation links** — spec: "Distinct button affordance with a copy icon." In practice `copyBtn()` sets `className = 'linklike copy-btn'`, the same base style as `linkA`/`linkBtn` (screenshots `06`, `15`: "Copy /ship resume" sits next to "Open PR ↗" with identical teal, no-icon styling). On a card, "Copy merge" (which mutates nothing but does put a shell command on the clipboard) looks exactly like "Plan"/"Scope"/"PR ↗" (pure navigation). A user skimming a "needs you" card can't tell copy-vs-navigate actions apart without reading each label. Fix: give `.copy-btn` a small clipboard glyph and/or a visibly different treatment (outline chip vs. plain link).

**Triage: fix-now (task/18-uiux-fixes).** `copyBtn()` now builds an outline-chip
button (`.copy-btn`, distinct from `.linklike`) with a `⧉` icon span plus a
label span; `flashCopied()` swaps only the label span to "Copied ✓" so the icon
persists through the feedback state. Verified via Playwright: icon present,
"Copied ✓" feedback shown on click.

**[med] Empty-state evidence line is missing the repo count the spec mandates** — DESIGN.md's own example: `"Scanned 2 roots (~/Develop, ~/code) · 14 repos · 0 flows — edit scan roots"`. The shipped `toggleEmptyState()` only ever renders `"Scanned N roots (...) · 0 flows"` (screenshot `26`) because `setup` (from `lib/config.js` bootstrap / `lib/engine.js`) never carries a repo count — the field doesn't exist anywhere in the data model. In daily use this is the difference between "shipyard found nothing to show" and "shipyard never actually walked your repos" — exactly the ambiguity the spec's wording was designed to remove. Fix: have the discovery walk report `repos.length` into `setup` and thread it through `getSnapshot()`.

**Triage: fix-now (task/18-uiux-fixes).** `lib/engine.js` `refreshDiscovery()`
now sets `setup.repoCount = repos.length` after every discovery pass, which
`getSnapshot()` already returns as part of `setup`. `toggleEmptyState()` renders
it as `· N repos` between the roots and flow count when present. Verified via
Playwright against a zero-flow snapshot: `"Scanned 2 roots (~/Develop, ~/code) ·
14 repos · 0 flows"`.

**[med] "Not started"/"Recently shipped" collapse at 5 rows, not the "one row" the spec specifies** — `renderCollapse()`: `limit = anyThin ? Math.min(5, total) : computeColumns(grid)`. Screenshot `30` shows 4+ thin rows visible with a "show all N" link already present, not a single collapsed row. This isn't obviously worse UX (more context per section, arguably better), but it's a hard deviation from the written, approved spec ("both sections collapse beyond one row"). Fix: either update the constant to 1 to match the doc, or update DESIGN.md to say 5.

**Triage: fix-now (task/18-uiux-fixes).** Changed the thin-row collapse limit
from `Math.min(5, total)` to `Math.min(1, total)` — one row for thin (task/
branch) sections, matching the spec text exactly; the card-grid branch already
used `computeColumns(grid)` (one row's worth of cards) and is unchanged aside
from also being clamped to `total`. "show all N" + `localStorage` persistence
behavior is untouched. Verified via Playwright: a two-item thin section shows
exactly 1 row collapsed.

## Low

**[low] Wait-age escalation (grey → amber → red) is functionally color-only** — `age-amber{font-weight:600}` vs `age-red{font-weight:700}`: a 100-weight difference at 11.5px is not a reliably perceptible non-color cue, unlike the pipeline strip (which correctly uses filled/outlined/✗-glyph shapes, screenshots `24`/`25` — genuinely good work there). A color-blind user can tell "waiting" from "not waiting" but likely can't tell 5h-amber from 1d-red apart without hovering. Fix: add a small icon or explicit unit-of-escalation (e.g. a filled dot that grows, or the ⚠/⏱ glyph already used elsewhere) alongside the weight change.

**Triage: fix-now (task/18-uiux-fixes).** Added a leading glyph alongside the
existing color/weight treatment — `⏱` at amber, `⚠` at red — via a new
`ageGlyph()` helper used wherever card age is rendered; `age-red` also picked
up a dotted underline. Verified via Playwright: every `.age-amber`/`.age-red`
chip's text includes its glyph.

**[low] Stale-section items inherit the same red "urgent" age styling as failing/needs-you items** — e.g. a 3-day-old dead branch in *Stale* renders in the identical bold red as a 1-day-stuck *Failing* card. Since *Stale* is explicitly the low-priority catch-all ("flows nothing else claims"), reusing the same alarm color there dilutes what red means everywhere else on the board. Low severity since it is literally what the spec describes (escalation is an orthogonal, group-independent axis) — flagging as a calibration question, not a bug.

**Triage: fix-now (task/18-uiux-fixes).** `ageClass()` now takes the card's
`group` and returns a dedicated `age-stale` class (mapped to the existing
muted `--stale` token) for any card in the Stale section, before falling
through to the normal grey/amber/red escalation for every other group — so a
stale item's age is never rendered in the same red used for actively failing
work. Verified via Playwright: no `.age` element inside the Stale section
carries `age-red`/`age-amber`.

**[low] Fenced code blocks in rendered markdown overflow with no visible scroll affordance** — `.drawer-body pre{overflow-x:auto}` works (confirmed `scrollWidth 477 > clientWidth 451`), but there's no scrollbar visible by default and no fade/gradient hint, so the clipped last few characters of a long code line (screenshot `12`, "Proof" tab) look like truncated/cut-off text rather than "scroll to see more." Fix: a subtle right-edge fade mask on `.drawer-body pre` when `scrollWidth > clientWidth`.

**Triage: fix-now (task/18-uiux-fixes).** `.drawer-body pre` now declares a
thin cross-browser scrollbar (`scrollbar-width: thin` plus WebKit scrollbar
rules); a new `markOverflowingPres()` helper runs after every drawer-body
render and tags any `<pre>` whose `scrollWidth > clientWidth` with
`.pre-overflow`, which paints a right-edge fade via `::after`. Verified via
Playwright: an overflowing Proof-tab code block gets `.pre-overflow` and the
thin-scrollbar declaration.

**[low] Clipboard-fallback popover input is too narrow, clipping the start of the command** — the "clipboard failed" popover (screenshot `31`) works exactly as specified (pre-selected, dismissable), but its fixed width means a longer command scrolls to show the tail with the beginning (`gh `) not visible at open; a user has to know to press Home/scroll-left before reading the full command they're about to copy manually.

**Triage: fix-now (task/18-uiux-fixes).** `showCopyPopover()` now renders a
`<textarea>` (was a single-line `<input>`) with `white-space: pre-wrap`,
`word-break: break-all`, and `overflow-y: auto` up to a capped height, so the
whole command wraps into view and stays selectable rather than scrolling
off-screen. Verified via Playwright with the clipboard API forced unavailable:
the fallback popover holds a wrapping/scrolling textarea with the full command
value.

---

## What already works well (calibration)

- **Pipeline strip** genuinely never encodes state by color alone: done = filled pill, current = distinct outlined pill, failed = outlined pill + explicit ✗ glyph in both the strip and the text label (screenshots `24`, `25`). This is the strongest accessibility work on the page.
- **Focus visibility** is real and consistent: `:focus-visible` outlines apply uniformly across cards, thin-rows, tabs, and links (screenshot `20`); `j`/`k` card-to-card navigation, `Enter` to open, and `Esc` to close all work, and `Esc` correctly restores keyboard focus to the originating card (verified via `document.activeElement`).
- **Deep-link hash routing** (`#flow/<id>/<tab>`) survives a full page reload and reopens the correct flow/tab (screenshot `11`), matching the spec's back/refresh/deep-link requirement.
- **Live-patch behavior** is solid: across a real 5s→10s poll cycle with a simulated stage change, the drawer patched in place, showed the inline "stage changed: ready-to-merge → merged" notice, kept the same open tab, and the board section counts updated — without closing the drawer or a full-page rebuild (screenshot `28`).
- **Copy-button feedback** (label swaps to "Copied ✓" for ~1.5s then reverts) and the **clipboard-denied fallback popover** both work exactly as specified, once you notice the button (see medium finding above about their affordance).
- **Narrow-width layout** (640px) correctly switches the drawer to a full-width slide-over with a working Back button (screenshot `29`), and chip rows cap at 2 chips + "+N" overflow as specified.
- **Markdown rendering** (headings, ordered lists, inline code, fenced code blocks, links) in Plan/Scope/Proof tabs is clean and readable in both themes (screenshot `09`).
- **Degraded-state chips** ("STATE.JSON UNREADABLE — CHECK THE RUN", "PR STATE UNKNOWN") are legible with good contrast in both light and dark themes (screenshot `27`).

---

## Also fixed on this branch (flagged by the prior QA wave)

**[plus] `setup.configError` was threaded into the engine's `setup` payload (task/17-qa-fixes) but never surfaced in the UI** — the setup banner rendered lines for `setup.created` and `setup.missingRoots` but had no case for `setup.configError`, so a corrupt (present-but-unparsable) config file fell back to defaults silently from the board's point of view, even though the server already logged it and the API already exposed it.

**Triage: fix-now (task/18-uiux-fixes).** `updateSetup()` now renders a
`configError` line ("Config file could not be parsed (...) — using defaults.")
in the setup banner when present, and shows the setup panel for a config error
even if `created`/`missingRoots` are both empty. Verified via Playwright
against a real `bin/shipyard` run started with a corrupt
`~/.claude/shipyard.config.json`.
