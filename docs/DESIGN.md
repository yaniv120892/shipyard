# Shipyard — design

A local, single-user web dashboard that shows every in-flight development flow —
`/ship` pipeline runs, open PRs, assigned Linear tasks, ambient git branches,
and local Claude-session activity — where each one stands, what it needs next,
and its full history, with one-click access to plan/spec docs and PRs.

Approved 2026-08-25 after two adversarial reviews (architecture + UI/UX); their
accepted findings are integrated below and marked where they changed the
original proposal. Product decisions and their rationale live in
`2026-08-25-session-visualization-questions.md`.

## Decisions (fixed)

| Topic           | Decision                                                                                       |
| --------------- | ---------------------------------------------------------------------------------------------- |
| Scope           | Everything on one board: ship runs, open PRs, Linear tasks, ambient branches, session activity |
| Non-/ship flows | Ambient detection from existing signals; no opt-in registration                                |
| Runtime         | Local machine only; remote claude.ai/code sessions → YAN-61                                    |
| Tracker         | Linear (workspace `yaniv-daye-personal`) behind a swappable provider interface                 |
| UI              | Local web app; card grid grouped by attention (mockup Option B)                                |
| Actions         | Open-helpers only (docs, editor, PR/Linear links, copy commands); richer actions → YAN-62      |
| History         | Archive ship-run state so it survives post-merge worktree deletion                             |
| Timestamps      | `/ship` history entries gain `{phase, at, note?}` — small PR to claude-config                  |
| Notifications   | None; passive "needs you" highlighting only                                                    |
| Repo            | New public repo `shipyard`                                                                     |
| Stack           | Zero-dependency Node 20+ (builtins only), no database — the filesystem is the persistence      |
| Config          | `~/.claude/shipyard.config.json`, bootstrapped on first run, editable from the UI              |

## Goal

After this ships, running `shipyard` opens a browser board that answers, at a
glance and without manual refresh: which flows need me right now (and for
what), which are progressing, which have failed or gone stale, and what
recently shipped — with the plan, scope, proof-of-work, phase reports, PR, and
Linear task of any flow one click away. Nothing about any pipeline changes
except a timestamp added to `/ship`'s history entries.

## Architecture

One Node process. On a cadence (below), _collectors_ observe the world,
_merge_ resolves their raw findings into unified Flow cards, _archive_ mirrors
live ship state, and the HTTP server feeds a single-page UI.

```
bin/shipyard          launcher: config bootstrap, port handling, opens browser
server.js             HTTP server + routes + auth token + Host check
lib/config.js         defaults, load/save, validation
lib/scan.js           discovery walk → repos; git worktree enumeration
lib/collectors/
  ship.js             .claude/ship/ state (live + torn-write cache)
  branches.js         non-default-branch worktrees, dirty state, commits
  prs.js              gh-based PR collector (GitHub repos only)
  sessions.js         Claude session transcript activity
lib/tracker/
  provider.js         interface: listMyOpenIssues(), issueUrl(), ticketPattern
  linear.js           Linear GraphQL implementation
lib/merge.js          findings → Flow cards: identity, dedupe, needsYou,
                      failure states, precedence
lib/archive.js        scan-time snapshot mirror + fate resolution + pruning
lib/ids.js            runId / repoKey derivation
lib/security.js       isInside(root, path), token issue/verify
public/index.html     the board (vanilla JS, no build step)
test/                 node:test units + fixture directory trees
```

## Identity

- **repoKey** — normalized origin remote URL (scheme/`.git`/case stripped);
  fallback for remote-less repos: the main worktree's real path (from
  `git worktree list`). Never a linked worktree's path.
- **runId** (ship runs) — truncated SHA-256 of `repoKey + branch + birth`, where `birth` is
  the first history entry's `at`; fallback for legacy runs without
  timestamps: `state.json` birthtime. Pinned into the archive entry at first
  snapshot and never recomputed after, so slug reuse or a re-run of the same
  branch cannot clobber an archived run.
- **flowId** (all cards) — ship runs use runId; PRs `pr:<repoKey>#<number>`;
  tasks `task:<identifier>`; branches `branch:<repoKey>#<branch>`; sessions
  `session:<repoKey>`.

## Data model

```
Flow {
  id, kind: ship|pr|task|branch|session,
  title, repo: {key, name, path}, branch,
  group: needsYou|failing|active|notStarted|stale|shipped,
  action: null | "answer-questions" | "approve-plan" | "merge",
  phase, timeline: [{phase, at, note}],
  waitingSince,                 // drives age escalation in the UI
  pr:   {number, url, state, isDraft, checks, reviewDecision, fetchedAt},
  task: {identifier, url, state, title},
  session: {lastActiveAt},
  docs: [{name, rel}],          // ship dir docs incl. reports/
  degraded: [{source, reason}], // e.g. "gh not authenticated"
  sources: [ship, pr, task, branch, session]  // chips on the card
}
```

### Dedupe — one real flow, one card

All joins key on `(repoKey, branch)`:

1. A ship run absorbs the PR on its branch (or the `pr` field in its state),
   the branch card, the matching task, and session activity for its worktree.
2. An ambient PR absorbs its branch card and matching task.
3. A task joins a branch/PR primarily by **ticket identifier** —
   `[A-Z][A-Z0-9]+-\d+` extracted case-insensitively from branch names and PR
   titles/bodies — with Linear's `gitBranchName` as a secondary exact match.
   When several branches match one ticket: prefer the one with a ship run,
   then an open PR, then the most recent commit; the losers keep their own
   cards with a "same ticket" badge. This tie-break has dedicated unit tests.
4. Session activity attaches as a badge to the repo's existing cards; it
   becomes its own card only when no other card represents that repo's work.
   Sessions map to repos by reading the `cwd` field from the first line of the
   newest transcript in each `~/.claude/projects/<dir>` (cached — it never
   changes), matched against repo/worktree real paths; the munged project dir
   name is never reverse-parsed, and transcripts are never tail-read on the
   fast tick — only their mtimes are.

### needsYou — a truth table, not a phase check

`phase` alone is ambiguous: `scope` covers both "scout agent working" and
"waiting 3 hours for the user's answers". The rule set (unit-tested with a
fixture tree per row):

| phase                                | gate artifact exists | recent agent activity* | group / action                     |
| ------------------------------------ | -------------------- | ---------------------- | ---------------------------------- |
| scope                                | `scope.md` present   | no                     | needsYou / answer-questions        |
| scope                                | —                    | yes                    | active                             |
| plan                                 | `plan.md` present    | no                     | needsYou / approve-plan            |
| plan                                 | —                    | yes                    | active                             |
| plan-approved, implement, polish, qa | —                    | yes                    | active                             |
| plan-approved, implement, polish, qa | —                    | no (beyond threshold)  | failing ("run died mid-`<phase>`") |
| ready-to-merge                       | —                    | —                      | needsYou / merge                   |
| merged, verified                     | —                    | —                      | shipped                            |

\* recent activity = any write inside `.claude/ship/` or a matching session
transcript mtime within the activity threshold (default 10 min, configurable).

### Failure and terminal states

- **failed** — QA reported failure (qa report present and verdict negative) or
  a mid-phase run with no activity beyond the threshold. Routes to _Needs you_
  with the reason as the card's status line.
- **aborted** — `/ship abort` recorded, or fate-resolved CLOSED (below).
  Grey terminal state; sits in _Recently shipped_'s collapsed list as
  "abandoned", never in _Stale_.
- **Vanished worktree** — when a previously-seen run's worktree is gone,
  resolve its fate once from the archived `state.json.pr` via
  `gh pr view --json state,mergedAt`: MERGED → shipped; CLOSED → abandoned;
  unknown → stale/unknown. The verdict is written into the archive entry so it
  is never re-queried.

## Scanning

Two cadences, so freshness never costs a full-disk walk:

- **Discovery walk** (every few minutes + on manual refresh + at startup):
  walk the configured roots with pruning (`node_modules`, `.git` internals,
  dot-dirs except `.worktrees`/`.claude`, bounded depth) to find _repos_.
  For each repo, enumerate worktrees via `git worktree list --porcelain` —
  this finds worktrees living **outside** the scan roots (harness- or
  cmux-managed). Classify each repo's forge from its remote URL once here.
- **Fast tick** (every ~5 s) + `fs.watch` on discovered `.claude/ship/` dirs:
  re-read known `state.json`s and doc mtimes only. `git status`/`rev-list`
  runs are cached per repo (keyed on `.git/HEAD` + index mtime) and staggered
  across ticks — never all repos in one tick.

**Torn writes:** the conductor rewrites `state.json` in place, so a read can
catch truncated JSON. Every parsed file keeps a last-known-good cache; a parse
failure serves the previous value and retries next tick; a warning (and the
error card) appears only after 3 consecutive failures. The same
last-known-good policy applies to `gh` and Linear results so one transient
error never repaints the board.

## Archive

- On **every scan**, mirror each discovered live `.claude/ship/` dir to
  `~/.claude/shipyard/history/<runId>/` — copy into a temp dir, then rename,
  so a conductor mid-write can't produce a torn snapshot. Idempotent: only
  changed files are re-copied. Archiving is scan-time, not merge-time, because
  the post-merge hook deletes the worktree synchronously and shipyard may not
  be running when the user merges; the archived copy is "latest state seen",
  and _Recently shipped_ is best-effort for merges that happen while shipyard
  is closed (the PR collector still sees the merged PR on next launch and
  promotes the archived run via fate resolution).
- Pruned at startup by `history.maxEntries` (default 200) and
  `history.maxAgeDays` (default 90).
- A pidfile under `~/.claude/shipyard/` locks the archiver; because snapshots
  are idempotent mirrors, a second writer would be wasteful, not corrupting —
  the lock exists to avoid the waste.

## Integrations

**GitHub (`gh`):**

- One `gh auth status` probe per refresh cycle gates all PR calls; on failure,
  exponential backoff and a source-health error — no per-repo retry spam.
- Only repos classified GitHub get PR collection:
  `gh pr list --author "@me" --state open --json ...` per local repo.
  Deliberately not a global search — the board covers work present on this
  machine. GitLab-remoted repos show a "PR state unavailable (GitLab)" badge;
  a forge-provider interface mirroring the tracker one is the future path.
- PR **list** data refreshes on the network TTL (default 90 s). Per-PR
  **detail** (checks rollup, review decision) is fetched only for cards at the
  merge gate and when a drawer opens — not polled for every card.

**Linear (`lib/tracker/linear.js`):**

- GraphQL with `LINEAR_API_KEY` from the environment; never stored in config.
- Default query: assigned to me, state type `unstarted` or `started`;
  config filters for teams/projects/states plus a result cap (default 50).
- Paginates with `first`/`endCursor` up to the cap; treats a GraphQL `errors`
  array as failure even on HTTP 200.
- The provider interface (`listMyOpenIssues()`, `issueUrl(id)`,
  `ticketPattern`) is the only Linear-aware surface; a Jira provider is one
  new file plus `tracker.provider` in config.

## HTTP server & security

All of these are mandatory, not hardening — `/api/open` shells out to an
editor, and a browser page can POST to localhost cross-origin:

- Bind `127.0.0.1` only.
- Random per-startup **token**, embedded in the served page, required as a
  custom header (`X-Shipyard-Token`) on every non-GET endpoint.
- Reject any request whose `Host` is not `127.0.0.1:<port>` or
  `localhost:<port>` (defeats DNS rebinding, which would otherwise also break
  same-origin protection for GET endpoints).
- The open-in-editor command is spawned via `execFile` with an argv array —
  never a shell string — and is **only** editable in the config file, not from
  the UI (breaks the CSRF-config-write → RCE chain).
- One shared `isInside(root, path)` helper: realpath both sides, then
  `path.relative` with no `..`/absolute result. Used by the doc endpoint and
  `/api/open`; allowed roots are the discovered worktrees and the archive dir.
  Unit-tested including symlink-escape and `repo` vs `repo-evil` prefix cases.

**Routes:** `GET /` (page), `GET /api/flows`, `GET /api/flow/<id>` (detail incl.
lazy PR detail), `GET /api/doc`, `GET /api/health` (version), `POST /api/open`,
`POST /api/refresh` (force network refresh), `POST /api/config` (setup panel;
scan roots and tracker filters only — never the editor command).

**Instances & ports:** on bind failure, probe `/api/health` on the configured
port; if an existing shipyard answers, print its URL and open the browser to
it instead of spawning a second instance; otherwise try the next port.

## Config & first run

`~/.claude/shipyard.config.json` (follows the claude-config convention of
machine-local config). Bootstrap: if absent, start anyway with default roots —
whichever of `~/Develop`, `~/dev`, `~/Projects`, `~/code` exist — and open the
board with a setup panel showing what was detected; saving writes the file.
Never blocks rendering.

```jsonc
{
  "port": 4111,
  "roots": ["~/Develop"],
  "maxDepth": 6,
  "activityThresholdMinutes": 10,
  "networkTtlSeconds": 90,
  "openCommand": "cursor", // file-editable only
  "ignore": ["repoName", "repo#branch-glob"],
  "history": { "maxEntries": 200, "maxAgeDays": 90 },
  "tracker": {
    "provider": "linear",
    "workspace": "yaniv-daye-personal",
    "teams": [],
    "projects": [],
    "states": [],
    "cap": 50,
  },
}
```

## UI

Card grid per the approved mockup (Option B), with the review fixes:

**Grouping & precedence.** Sections: Needs you → Failing → Active → Not
started → Stale → Recently shipped. A flow belongs to exactly one, by hard
precedence `needsYou > failing > active > notStarted > stale`. Staleness is
an orthogonal _age_: each card shows how long it has waited, escalating grey →
amber (~4 h) → red (~1 d); sections sort longest-waiting first. The _Stale_
section holds only flows nothing else claims (dead branches, idle sessions).
Empty sections render nothing.

**Cards.** Title, source chips, status chip that names the needed action
("Answer questions" / "Approve plan" / "Merge") or the failure reason, mini
pipeline strip (ship runs), wait-age, repo·branch line, open-helper links.
Merge-gate cards print CI data age beside the CI chip ("CI 5/5 · 1m").
Degraded enrichment shows an explicit chip ("PR state unknown"), never
silently missing fields; an unparseable `state.json` renders an error card.
In _Not started_ and _Recently shipped_, thin kinds (task-only, branch-only)
render as one-line list rows, and both sections collapse beyond one row
("show all N", state kept in `localStorage`).

**Pipeline strip.** Segments = scope, plan, implement, polish, qa, merge,
with a terminal cap for merged/verified. Per-segment tooltip (stage name +
completion time from the timeline). Label reads "now: qa · next: merge".
Failed segment gets an ✗ glyph; current segment a distinct outlined shape —
state is never encoded by color alone.

**Detail drawer.** Bound to a flow id, addressed by URL hash
(`#flow/<id>/<tab>`) so back/refresh/deep-links work. Content: status header
first (current stage, needed action + links, last event + time), then the
original request verbatim, then tabs: timeline with per-phase reports ·
plan.md · scope.md · proof-of-work.md (markdown rendered client-side) · PR
checks & review · git (ahead/behind, last commits, dirty files). On live
update the drawer patches in place and shows an inline "stage changed:
implement → qa" notice — it never closes or resets scroll.

**Live updates.** Keyed per-card DOM patching by flow id — no innerHTML
rebuilds. Section moves are batched with a brief highlight on the moved card;
no within-section reordering while the pointer is over the grid. The page
polls `/api/flows` every ~5 s; a "refresh now" button hits `/api/refresh` for
network sources.

**Header.** Sticky. Stat chips — needs you / failing / active / stale — are
clickable filters whose counts always equal section counts. A per-source
health row sits behind the freshness indicator: `git ✓ 4s · gh ✗ not
authenticated · linear ✓ 1m`, click for the underlying error.

**Empty & misconfigured states.** The empty board states its evidence:
"Scanned 2 roots (~/Develop, ~/code) · 14 repos · 0 flows — edit scan roots".
A missing or unreadable root is an error banner, not silence.

**Copy actions.** Distinct button affordance with a copy icon; click swaps to
"Copied ✓" for ~1.5 s; tooltip shows the exact command; clipboard failure
falls back to a popover with the command pre-selected.

**Accessibility & small windows.** Cards are focusable; Enter opens the
drawer, Esc closes, j/k move between cards; visible focus ring. Below ~700 px
the drawer becomes a full-width slide-over with a back button, and card chip
rows cap at two chips with a "+N" overflow.

## The /ship change (PR to claude-config)

In `plugins/dev-workflows/skills/ship/SKILL.md`, the history rule becomes:
append `{"phase": "<completed phase>", "at": "<UTC ISO-8601>", "note": "<one
line, optional>"}` per completed phase. `dev-workflows` plugin version bumps.
Shipyard's parser accepts all three shapes — objects, legacy freeform strings
(`{note, at: null}` with report-file-mtime fallback for that segment), and
mixed arrays — with a mixed-array fixture test.

## Error handling summary

Every collector fails soft to a per-source health status plus per-card
`degraded` entries; the board always renders. Transient failures are absorbed
by last-known-good caches and surfaced only when persistent. Nothing in
shipyard ever writes to a worktree, a repo, GitHub, or Linear.

## Testing

- `node:test` units: merge/dedupe (including the multi-branch ticket
  tie-break), the needsYou truth table per fixture tree, history parsing
  (object/string/mixed), runId stability across worktree deletion,
  `isInside` path safety (symlink escape, sibling-prefix), archive fate
  resolution, config bootstrap.
- Collectors run against fixture directory trees checked into `test/`;
  `gh`/Linear are wrapped in thin call layers stubbed in tests.
- Proof of work: a real scan on the developer's machine with live ship runs.

## Out of scope (tracked)

- Remote claude.ai/code sessions → [YAN-61](https://linear.app/yaniv-daye-personal/issue/YAN-61)
- Mutating/launch actions, desktop notifications, card dismissal beyond the
  config ignore-list → [YAN-62](https://linear.app/yaniv-daye-personal/issue/YAN-62)
- GitLab PR enrichment (forge provider), Jira tracker provider, kanban and
  dense-table view modes — deliberate later increments; the provider
  interfaces and view-agnostic data model are the enabling seams.
