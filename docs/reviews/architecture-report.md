# Shipyard — final architecture gate review

Branch `task/18-uiux-fixes`, reviewed 2026-08-26. Read-only inspection of the full runtime
surface (`lib/`, `server.js`, `bin/shipyard`, `public/index.html`), `docs/DESIGN.md`,
`CLAUDE.md`, and both review reports. Gate question: **ready to extend, not over-engineered.**

Severity counts: **0 high · 5 medium · 6 low.** `npm test` passes (0 failures).

---

## Extension-seam walkthroughs (dimension 1)

### Jira tracker — essentially as promised

Concrete steps to add Jira:

1. Write `lib/tracker/jira.js` exporting `{ name, listMyOpenIssues(trackerCfg) }` returning
   `{ ok, issues: [{identifier, title, url, branchName, state}] }` (the shape `lib/engine.js`
   and `lib/merge.js` actually consume).
2. Add one line to the `PROVIDERS` map in `lib/tracker/provider.js`.
3. Set `tracker.provider: "jira"` in config.

That is "one new file + one registry line + a config value" — functionally as promised.
Everything downstream is provider-agnostic: `merge.js` joins on `identifier`/`branchName`/
`title` via the generic `extractTicket` in `lib/ids.js` (whose `[A-Za-z][A-Za-z0-9]+-\d+`
pattern already matches Jira keys), and `engine.js` filters `tracker.states` by plain string.

Linear-specific leakage outside `lib/tracker/` (all cosmetic, none blocking):

- `lib/engine.js:87,274-280` — the health source is keyed `linear` literally; a Jira setup
  would report tracker health under a chip labeled "linear".
- `public/index.html:2064` — the health row hard-codes `['git','gh','linear']`.
- The Setup panel's "Tracker workspace" field is Linear-shaped (and dead — see finding M5).

Minimal change when Jira lands: key health by `provider.name` (or rename to `tracker`).

**Triage: no action (task/19-arch-fixes).** Cosmetic-only per the report itself, deferred
correctly until a second tracker actually lands (see L6 below, which names the same leak).

### GitLab forge provider — clean implicit interface, single-instance wiring

The gh client (`lib/collectors/prs.js` `createGhClient`) has a tidy four-method shape —
`authStatus()`, `listOpenPrs(repoPath)`, `prDetail(repoPath, number)`,
`prState(repoPath, number)` — all returning `{ok, ...}`/`{ok:false, reason}`, and it is
already injected (`deps.ghClient` in `createEngine`, used by tests). The shape is reusable
as-is by a `glab`-backed client. What is single-forge today:

- `engine.js:73` instantiates exactly one client; `engine.js:247` gates collection on
  `repo.forge !== 'github'`; `engine.js:172-176` hard-codes the GitLab degraded chip.
- `archive.js resolveFates(historyDir, liveRunIds, ghClient)` takes the one client; archive
  `meta.json` records `repoPath` but not `forge`, so fate resolution can't pick a client.
- Health is keyed `gh` in engine and UI.

**Minimal seam** (defer until GitLab is real — correct YAGNI state today): a
`lib/forge/provider.js` registry mirroring the tracker one, keyed by the `forge` field
`scan.js classifyForge` already computes per repo; engine picks the client per repo; add
`forge` to archive meta so `resolveFates` can select. No method-shape redesign is needed —
`gh` is *not* hard-wired in a way a second forge can't satisfy.

**Triage: no action (task/19-arch-fixes).** Deliberate deferral per the report; the seam is
already in place, nothing to build until GitLab is a real requirement.

### New view modes (kanban / dense table) — clean

`group`, `action`, `statusLine`, `waitingSince` are computed server-side in
`lib/merge.js classify()` as *data*; `/api/flows` returns a flat flow list plus
health/setup. Every grid assumption (sections, columns, collapse, thin rows,
`localStorage` expand state) lives in `public/index.html` render functions only. A kanban
or dense-table mode is purely an alternative render path over the same payload. Nothing in
the data model or API assumes the card grid.

**Triage: no action (task/19-arch-fixes).** Observation only — confirms the seam is clean;
no future work implied for this branch.

### YAN-61 (remote sessions) — natural place exists, one join caveat

Plug-in point: a new collector in `lib/collectors/` producing session-shaped findings,
composed in `engine.assemble()` like the local one. Caveat: both session joins are
local-path-based (`merge.js:157` matches `f.worktree === session.cwd`; `engine.js:183`
matches `underRoot(wt.path, session.cwd)`), and a remote session has no local cwd — the
join would need a repoKey/remote-URL match added in `merge.js`. A contained change, not a
rearchitecture.

**Triage: fixed on this branch, incidentally (task/19-arch-fixes).** The join-inconsistency
the caveat points at is exactly M1 below; `merge.js` now shares `underRoot` with
`engine.js`. The YAN-61 remote-session-join extension itself remains out of scope, unchanged.

### YAN-62 (richer actions) — natural place exists

The template is complete: `server.js` POST routes behind the token + Host checks,
`engine.openInEditor` shows the safe-execution pattern (execFile argv, path pre-validated
through `docPath`/`isInside`), and `renderLinks`/`wireDrawerActions` in the UI are the
affordance points. A new action = one POST route + one engine method + one button. The only
stretch: `flow.action` is a single enum string; multiple concurrent actions per card would
widen it to a list — a small, obvious change when needed, not worth pre-building.

**Triage: no action (task/19-arch-fixes).** Observation only; out of scope (YAN-62).

---

## Findings, ordered by severity

### Medium

**[med] M1 — Session badge silently missing for sessions in worktree subdirectories** —
blocks the core "session activity attaches as a badge" behavior (DESIGN §Dedupe rule 4).
`lib/merge.js:157` attaches sessions by strict equality `f.worktree === session.cwd`, while
`lib/engine.js:183` uses subtree containment (`underRoot`). A Claude session whose cwd is a
subdirectory of a worktree that already has a flow matches neither path: merge misses it
(strict equality), and the engine suppresses the standalone card because the repo has flows
(`engine.js:191`). The session is invisible everywhere. **Minimal change:** use the same
containment test in `merge.js` (export `underRoot` or move it next to `isInside`), plus one
unit test with a subdirectory cwd.

**Triage: fixed on this branch (task/19-arch-fixes).** `underRoot` moved to
`lib/security.js` and is now shared by both `lib/merge.js` (session→flow join) and
`lib/engine.js` (standalone session card suppression). Covering test:
`test/merge-joins.test.js` — "a session cwd in a subdirectory of the worktree still
attaches to the flow".

**[med] M2 — `tracker.teams` / `tracker.projects` are config nothing reads** — DESIGN
§Integrations promises "config filters for teams/projects/states plus a result cap"; the
Linear query (`lib/tracker/linear.js:1-12`) hard-codes its filter and only `states` (in
`engine.js:164`) and `cap` are honored. A user who sets `teams` gets it silently ignored.
Same class: `stateType` is fetched and stored per issue (`linear.js:45`) but read by
nothing. **Minimal change:** delete the `teams`/`projects` keys from `DEFAULTS`
(`lib/config.js:17-18`) and drop `stateType` — reintroduce them the day a filter is
implemented. (Over-engineering rule: removal, not implementation, unless the filter is a
real current need.)

**Triage: fixed on this branch (task/19-arch-fixes).** `teams`/`projects` removed from
`DEFAULTS.tracker` (`lib/config.js`); `stateType` dropped from the Linear provider's output
and its now-unused `type` GraphQL selection removed (`lib/tracker/linear.js`). DESIGN's
Integrations section and config example updated to match (`docs/DESIGN.md`); README's config
table updated. Tests updated: `test/linear.test.js`, `test/merge-joins.test.js`,
`test/config.test.js`, `test/engine.test.js`.

**[med] M3 — `health.git` is a lie: initialized `{ok: true}` and never updated** —
`lib/engine.js:85` is the only write; `gitP` (`lib/scan.js:23`) swallows every git failure
to `null`. The per-source health row DESIGN §UI mandates can never show a git failure — a
missing `git` binary or a permission-broken repo shows "git ✓" forever while cards quietly
degrade. **Minimal change:** either count `gitP` nulls per discovery pass into
`health.git`, or remove the `git` entry from health and the UI row until it reports truth.
Either is small; the current state is the worst of both.

**Triage: fixed on this branch (task/19-arch-fixes).** Took the "count real outcomes" option.
`gitP` now accepts an optional `stats` accumulator (`lib/scan.js`); `discoverRepos` threads
it only through the `git worktree list --porcelain` probe — the one call that runs for every
discovered repo and fails on a missing git binary or permission-broken repo, unlike
`remote get-url`/`symbolic-ref`, which fail routinely for ordinary remote-less repos and
would make "honest" health noisy instead. `engine.refreshDiscovery` derives `health.git` from
the real call/failure counts each pass; initial state changed from an unconditional
`{ok: true}` to `{ok: false, reason: 'not checked yet'}`, matching `gh`/`linear`. Covering
test: `test/scan.test.js` — "gitStats records real git-probe outcomes, including a broken
.git dir".

**[med] M4 — `sameTicketAs` is computed, tie-break-tested, and never rendered** — DESIGN
§Dedupe rule 3: losers "keep their own cards with a *same ticket* badge". `lib/merge.js:132`
sets it; nothing in `public/index.html` reads it (no chip, no badge). The multi-branch
tie-break — which has dedicated unit tests — is invisible to the user it was specified for.
**Minimal change:** one chip in `buildChips()` when `flow.sameTicketAs` is set. (If the
badge is being dropped as a product call, delete the field instead — but the tests say it
is meant to be real.)

**Triage: fixed on this branch (task/19-arch-fixes).** `buildChips()` in `public/index.html`
now pushes a `Same ticket: <identifier>` chip when `flow.sameTicketAs` is set. Verified in
demo mode: `test/fixtures/demo-flows.json`'s `price-alerts` flow was given
`"sameTicketAs": "YAN-42"` (no fixture previously carried a non-null value) and the chip
was confirmed rendering via a Playwright pass against `--demo`.

**[med] M5 — Dead provider method + config key + live Setup field: `issueUrl` /
`tracker.workspace`** — `linearProvider.issueUrl` (`lib/tracker/linear.js:16`) has zero
callers (issues carry `url` straight from the API), `tracker.workspace` exists only to feed
it, and the Setup panel exposes a "Tracker workspace" input (`index.html:940-941, 2180-2185`)
whose saved value therefore changes nothing — a user-facing control that does nothing.
**Minimal change:** remove `issueUrl`, the `workspace` default, and the Setup field. This
also shrinks the tracker interface a Jira provider must satisfy to the one method actually
used.

**Triage: fixed on this branch (task/19-arch-fixes).** `linearProvider.issueUrl` removed;
`tracker.workspace` dropped from `DEFAULTS` (`lib/config.js`); the Setup panel's "Tracker
workspace" label/input and its save-time `body.tracker = { workspace }` wiring removed from
`public/index.html`. `docs/DESIGN.md` (architecture diagram comment, provider-interface
sentence, config example) and `README.md`'s config table updated to match. Tests updated:
`test/config.test.js` (workspace field replaced with `states` in the allow-listed-keys
assertion), `test/linear.test.js`, `test/engine.test.js`.

### Low

**[low] L1 — `qaFailed` heuristic matches innocent notes** — `lib/merge.js:189-191` flags
`/fail/i` in any timeline note (with a qa association): a note like "qa: 0 failures" marks
an idle run *failing* with "QA reported failure". DESIGN says the signal is "qa report
present and verdict negative". Minimal change: require a negative verdict token (or read
the qa report) rather than substring `fail`. One test.

**Triage: fixed on this branch (task/19-arch-fixes).** The regex tightened from `/fail/i` to
`/\bfailed\b/i` — a note like "qa: 0 failures" (noun "failures") no longer matches, while a
genuine "QA FAILED: ..." verdict still does. The run is still classified `failing` either
way when stalled (that's the stalled-run rule, unrelated to the QA verdict itself); only the
misleading `statusLine` text changes, from "QA reported failure" to "run stalled mid-qa" for
the innocent case. Covering tests added to `test/merge-classify.test.js`: the "0 failures"
case and a "QA FAILED" case that confirms the genuine-failure path is untouched.

**[low] L2 — Demo engine breaks two POST routes** — `scripts/demo.js buildDemoEngine`
lacks `refreshDiscovery` and `updateConfig`; `server.js:69,75` call both unconditionally,
so "Refresh now" and Setup-save 500 in `--demo` mode. Two no-op stubs fix it.

**Triage: fixed on this branch (task/19-arch-fixes).** Added `refreshDiscovery` and
`updateConfig` no-op async stubs to `buildDemoEngine()` in `scripts/demo.js`, per the
suggested minimal fix. Not independently unit-tested (no existing harness drives
`--demo` through `server.js`'s POST routes); confirmed manually via the Playwright pass
used for M4/(c) that `--demo` mode serves without error.

**[low] L3 — gh health is last-writer-wins across the repo loop** — `engine.js:248-259`:
with multiple GitHub repos, one failing repo mid-loop can be masked (or mask the others)
depending on iteration order; also DESIGN's promised "exponential backoff" for gh does not
exist (a plain per-cycle probe does — arguably the simpler right answer; update the doc
rather than the code).

**Triage: partial — doc portion fixed on this branch (task/19-arch-fixes), masking issue
accepted as-is.** The report gives a concrete minimal fix only for the doc/code mismatch:
`docs/DESIGN.md`'s Integrations section no longer claims exponential backoff, and now states
the actual behavior (a plain per-cycle probe) as the deliberate, simpler choice. The
last-writer-wins masking across multiple GitHub repos has no minimal fix specified in the
report — left as observed, not silently changed; a candidate for a future ticket if it
causes real confusion with multi-repo GitHub setups.

**[low] L4 — `pending` branch-card flag is plumbed but unread** — `lib/collectors/
branches.js:43-58` distinguishes "detail not yet fetched (budget)" from "fetched"; no UI
or merge consumer reads it. Remove, or render it in the git tab; today it is dead weight.

**Triage: fixed on this branch (task/19-arch-fixes), by removal.** Took the deletion option
(the one the report's own verdict groups with M2/M5/L5 as "removals" the over-engineering
audit found and endorsed). `pending` removed from `createBranchCollector`'s card output;
`test/branches.test.js`'s budget-staggering test rewritten to assert on `lastCommitTs == null`
(unfetched vs. fetched detail) instead of the removed flag — same behavior under test, no
loss of coverage.

**[low] L5 — Archiver pidfile is write-only** — `bin/shipyard:58-65` writes
`archiver.pid` and removes it on `exit`, but *nothing anywhere reads it* — the "lock"
DESIGN §Archive describes does not exist. See triage (a): the right fix is deletion.

**Triage: fixed on this branch (task/19-arch-fixes).** See (a) below — same fix.

**[low] L6 — Tracker health key naming will mislabel a second provider** — the concrete
Linear leakage named in the Jira walkthrough (`engine.js:87`, `index.html:2064`). No action
now; rename to `provider.name`-keyed when a second tracker actually lands.

**Triage: no action, as the report itself directs (task/19-arch-fixes).** Explicitly
deferred by the report ("no action now"); nothing changed.

### Explicitly checked and clean (no finding)

- **Dependency direction:** no `lib/` file imports `server.js` or `public/`; the only
  server import outside `bin/` is `scripts/demo.js` (a launcher — correct direction). The
  eslint `no-restricted-imports` regex enforces the zero-dependency rule.
- **Collectors are pure observers:** ship/branches/sessions only stat/read; all git and gh
  invocations are read-only subcommands. The only writer is `archive.js`, confined to
  `~/.claude/shipyard/history`, composed solely by the engine.
- **Engine as sole composition point:** all collector/provider/archive wiring is in
  `createEngine`, with every dependency injectable (`deps.*`) — used consistently by tests.
- **Security helpers at every boundary:** `isInside` (realpath + relative check) guards the
  only path boundary (`docPath`, feeding both `/api/doc` and `/api/open`); every child
  process is `execFile` with argv arrays (`gitP`, gh client, `openInEditor`, `openBrowser`);
  token on all non-GET, Host allowlist on everything, bind 127.0.0.1 only,
  `openCommand` never accepted from a request. Matches CLAUDE.md invariants exactly.
- **Pattern consistency:** `{ok, reason}` fail-soft is uniform across gh/tracker; last-
  known-good caching is uniform (ship collector `FAIL_LIMIT` cache; `network.prsByRepo`/
  `tasks` retained on failure); the one deviation is `gitP` returning bare `null`, which is
  what leaves `health.git` blind (M3).
- **Over-engineering scan:** the codebase is notably lean — 979 lines of `lib/`, one
  registry with one entry (justified by a named second: Jira), no speculative forge
  abstraction (correctly deferred), no unused indirection beyond the removals named in
  M2/M5/L4/L5. Nothing else to strip.

**Triage: no action (task/19-arch-fixes).** Clean-bill observations; no findings to address.
(The `gitP` bare-`null` deviation this section flags as the cause of M3 is resolved by M3's
fix above — `gitP` now also reports outcomes via the optional `stats` accumulator, alongside
its existing `null`-on-failure return value used elsewhere.)

---

## Triage of the five known open minors

**(a) Archiver pidfile not removed on SIGTERM/SIGINT — fix-now, by deletion.** Nothing
ever reads `archiver.pid`, so the lock it claims to be is a no-op and a stale file has zero
consequence; delete the whole block in `bin/shipyard:56-65` (and the DESIGN sentence)
rather than adding signal handlers to maintain a dead artifact. If it must stay, the fix is
three lines of `process.on('SIGINT'/'SIGTERM')`.

**Triage: fixed on this branch (task/19-arch-fixes).** Whole pidfile block deleted from
`bin/shipyard` (including its now-unused `fs`/`os`/`path` imports); `docs/DESIGN.md`'s
Archive section rewritten to drop the pidfile-lock sentence, per the report's preferred
"delete, don't repair" option.

**(b) Scope/plan run with no gate doc and stale activity classifies 'active' — fix-now.**
Confirmed in `lib/merge.js:194-203`: the gate branch has no `!gateReady && !recent` arm, so
"agent died before writing scope.md" shows "agent working: scope" *forever* — exactly the
invisible-death class the needsYou truth table exists to prevent, and the table's only
missing row. Fix is ~3 lines (`return set('failing', null, 'run stalled mid-<phase>')`)
plus one fixture-tree test row.

**Triage: fixed on this branch (task/19-arch-fixes).** Added the missing `!gateReady &&
!recent` arm to `classify()` in `lib/merge.js`, returning `failing` with statusLine
`run stalled before <gate doc>` (e.g. "run stalled before scope.md"), matching the phrasing
the report anticipated. `docs/DESIGN.md`'s needsYou truth table gained the two missing rows
(scope and plan, gate absent + stale). Truth-table test rows added to
`test/merge-classify.test.js`'s `CASES` array plus an explicit statusLine-text assertion.

**(c) Failed pipeline segment shows ✗ in the label, not on the glyph — fix-now.**
`.pipe i.now.fail` (`index.html:425-429`) differs from `.now` only by red-vs-amber — the
strip itself *does* encode failed-vs-current by color alone, contradicting the spec line
"state is never encoded by color alone" (the ✗ lives only in the text label). One CSS rule
(`.pipe i.now.fail::after { content:'✗'; ... }`) closes it; too cheap to ticket.

**Triage: fixed on this branch (task/19-arch-fixes).** Added `.pipe i.now.fail::after` in
`public/index.html`, rendering a small `✗` glyph above the failed segment itself (not just
in the `.pipe-label` text), per the suggested fix. Verified via a Playwright pass against a
failing-fixture card in `--demo` mode that the `::after` content is present and visible.

**(d) No end-to-end regression test for drawer doc-tab loading — ticket.** The server side
(`docPath`, `listDocs` rel shapes, archive remap) has unit coverage in
`test/engine.test.js`/`test/ship-collector.test.js`; the untested layer is the browser
fetch path (`loadDocContent` using `doc.rel` vs `doc.name`), which has now bitten twice
(QA H1, UI/UX med). It needs a Playwright-style harness the repo deliberately doesn't
have — not worth building today, but the recurrence rate earns a ticket attached to the
next UI change.

**Triage: ticket, as the report directs.** No code change on this branch — a
Playwright-style browser harness is a larger investment than this fix round's scope; the
one-off Playwright pass used to verify M4/(c) above confirms the current behavior but does
not stand in for the regression harness this finding asks for.

**(e) `engine.docPath` archive remap is string-prefix-based — accept-as-is.** The
`startsWith('.claude/ship/')` guard anchors the `replace` to the prefix, so it is correct,
and the `rel` convention is a two-file contract (`ship.js listDocs` ↔ `engine.docPath`)
both sides of which are unit-tested. Extracting a shared constant is symmetry, not need.

**Triage: accepted as-is, as the report directs.** No change; the report finds the current
code correct as written.

---

## Verdict

**Pass — ready for its named future.** The three promised seams are real, not aspirational:
Jira is genuinely one file plus a registry line (with only a cosmetic health-label leak),
GitLab needs no interface redesign because the gh client's injected four-method shape is
already the interface — only per-forge selection and a `forge` field in archive meta are
missing, and correctly so until GitLab is a real requirement — and new view modes touch
only `public/index.html` because grouping is data, not layout. Boundaries hold everywhere
inspected: one-way dependency flow, pure-observer collectors, a single composition point,
and security helpers at every path/exec boundary exactly as CLAUDE.md demands. The
over-engineering audit found the opposite failure mode almost nowhere — the flagged items
(dead `teams`/`projects`/`workspace` config, uncalled `issueUrl`, write-only pidfile,
unread `pending`/`stateType`) are small accretions to delete, not architecture to unwind.
The medium findings are wiring gaps (an inconsistent session join, a health chip that
cannot fail, a spec'd badge never rendered), each a sub-hour fix; with those and known
minors (a)–(c) landed, this codebase is a sound, appropriately-sized base for YAN-61,
YAN-62, Jira, GitLab, and new views.

---

## Triage summary (task/19-arch-fixes)

| # | Finding | Disposition |
| --- | --- | --- |
| M1 | Session join misses worktree subdirectories | Fixed |
| M2 | Dead `tracker.teams`/`projects`/`stateType` | Fixed (removed) |
| M3 | `health.git` never reflects real outcomes | Fixed |
| M4 | `sameTicketAs` computed but never rendered | Fixed |
| M5 | Dead `issueUrl`/`tracker.workspace`/Setup field | Fixed (removed) |
| L1 | `qaFailed` matches innocent "fail" substrings | Fixed |
| L2 | Demo engine 500s on two POST routes | Fixed |
| L3 | gh health last-writer-wins / backoff doc mismatch | Doc portion fixed; masking issue accepted as-is (no minimal fix given) |
| L4 | Unread `pending` branch-card flag | Fixed (removed) |
| L5 | Write-only archiver pidfile | Fixed (removed; same as (a)) |
| L6 | Tracker health key naming (`linear` literal) | No action (report says defer) |
| (a) | Archiver pidfile not cleaned on SIGTERM/SIGINT | Fixed (removed) |
| (b) | Stalled scope/plan run misclassified `active` | Fixed |
| (c) | Failed pipeline segment ✗ missing from glyph | Fixed |
| (d) | No e2e regression test for drawer doc-tab loading | Ticket (report directs) |
| (e) | `docPath` archive remap is string-prefix-based | Accepted as-is (report directs) |
