# Shipyard — blind QA report

Tester had no access to plans/history; judged only against the user's original
request and the Goal / Decisions (fixed) sections of `docs/DESIGN.md`.
Branch: `task/16-launcher`. All servers used ports 4600–4699 (except
`scripts/demo.js`, which hardcodes 4111 per its own source and was run as
instructed); every server started during this QA pass was killed.

## Summary

- **npm test**: 59/59 pass, 0 failures.
- **High**: 3
- **Medium**: 3
- **Low**: 2

## What worked (coverage calibration)

- `npm test` — clean pass, no flakes across a run.
- `node scripts/demo.js` — boots a full mock board matching the mockup promise:
  grouping by attention (needs you / failing / active / not started / stale),
  pipeline mini-timeline, PR/CI chips, drawer with Status/Request/Timeline/
  Plan/Scope/Proof/PR/Git tabs, "Copy /ship resume", "Open in editor". Only
  console noise was Google Fonts being blocked by this sandbox's network
  (irrelevant to the product).
- Real end-to-end fixture (`test/helpers/gitfix.js`, two repos, a worktree with
  a real timestamped `.claude/ship/state.json` sitting at a human gate, plus a
  dirty ambient branch): discovery, grouping (`needsYou`/`approve-plan`),
  timeline rendering, and dedupe against the branch card all worked correctly
  once file mtimes/commit dates were realistically backdated.
- Classification logic (`lib/merge.js` `classify()`) is sound: plan/scope gate
  detection, stalled-run detection, QA-failure detection, and stale-branch
  aging all matched expectations in manual trials.
- Cold-start torn `state.json` (file already truncated before the process
  starts) correctly surfaces as `failing` / "state.json unreadable — check the
  run" after 3 read attempts — matches its own unit test's intent.
- Mid-flight torn write (truncated while the server was already running and
  had a good cached copy) never crashed the server and kept serving
  last-known-good data — by design, and consistent with the "torn-write
  cache" unit test.
- Second-instance launch: starting `bin/shipyard` again on an occupied
  shipyard port correctly detects the running instance via `/api/health` and
  exits with "shipyard already running... — opening it" instead of erroring
  or double-binding.
- Empty roots array in config (`{"roots":[]}`) is handled cleanly: 0 flows,
  clear "Scanned 0 roots · 0 flows" empty state with an "edit scan roots"
  link — no crash, no confusing error.
- Nonexistent roots in config are reported via `setup.missingRoots` and shown
  in the UI as "Missing / unreadable roots: ...".
- `gh` genuinely absent from this machine (`which gh` → not found, no gh
  binary anywhere) and `LINEAR_API_KEY` unset: server didn't crash, board
  loaded, and both are surfaced as visible health chips
  ("gh ✗ gh not authenticated", "linear ✗ LINEAR_API_KEY not set").

## High severity

### H1 — Plan/Scope/Proof-of-work docs never load for any real ship run
**User experience:** Click a card's "Plan" or "Scope" chip, or the drawer's
Plan/Scope/Proof tab, on any real (non-demo) flow → "Plan doc could not be
loaded." Every doc-open path is broken, live or archived. This directly
breaks the user's explicit ask: "I want to easily open the plan/spec docs."

**Cause (observed, not fixed):** `lib/engine.js` `docPath(flowId, rel)`
resolves `rel` (e.g. `plan.md`) directly against `flow.worktree` — but real
`/ship` docs live at `<worktree>/.claude/ship/plan.md`, one level down. The
same bug is present in the archive fallback: an archived run's docs are
stored at `<historyDir>/<runId>/ship/plan.md`, but `docPath` resolves against
`<historyDir>/<runId>` — off by exactly the same missing `ship/` segment.
Only the demo works, because `scripts/demo.js`'s fixture embeds doc `content`
inline in the flow JSON, bypassing `/api/doc` entirely.

**Evidence:**
```
$ curl -s "http://127.0.0.1:4601/api/doc?flow=<real-ship-flow-id>&file=plan.md"
{"error":"not found"}
```
Confirmed both via direct curl and via Playwright clicking the "Plan" tab in
the browser (screenshot: drawer shows "Plan doc could not be loaded."). Same
404 reproduced against an archived run's `proof-of-work.md` after its
worktree was deleted. `POST /api/open` with the same file also 404s, so
"open in editor" for a doc is equally broken — only "Open in editor" for the
whole worktree root works, because `file='.'` happens to resolve correctly.

**Triage: fix-now (task/17-qa-fixes).** `listDocs` now emits `rel` as
`.claude/ship/<name>` instead of the bare name, and `engine.docPath` maps that
`.claude/ship/` prefix onto the archive's `ship/` layout for the archive
fallback root. Covered by `test/ship-collector.test.js` and
`test/engine.test.js`.

### H2 — Editing scan roots in the Setup UI has no effect on the running board
**User experience:** Open Setup, change/add a scan root, click Save → "Saved
✓". The new root is never scanned; no new flows ever appear from it, with no
error and no indication that a restart is required. This breaks the fixed
design decision "Config ... editable from the UI."

**Cause (observed):** `POST /api/config` (`saveUserConfig`) only writes
`~/.claude/shipyard.config.json` to disk. The running engine's in-memory
`config` object (captured once at process start in `bin/shipyard`) is never
reloaded — not immediately, and not on the periodic 5-minute rediscovery
either, since that timer reuses the same stale `config.roots` reference.

**Evidence:**
```
$ curl -s -X POST http://127.0.0.1:4601/api/config -H "x-shipyard-token: $T" \
    -d '{"roots":["/tmp/shipyard-scan-74UWZ2","/tmp/shipyard-scan-NEWROOT"]}'
{"saved":{"roots":["...74UWZ2","...NEWROOT"], ...}}   # disk file updated correctly
$ cat .../shipyard.config.json     # roots array does contain the new root
$ curl -s http://127.0.0.1:4601/api/flows | jq .setup.roots
["/tmp/shipyard-scan-74UWZ2"]      # in-memory snapshot unchanged, before AND after 6s of ticking
```
A brand-new repo (`repo-delta`) placed under the newly-saved root never
appeared in `/api/flows` while the process kept running.

**Triage: fix-now (task/17-qa-fixes).** Added `engine.updateConfig(saved)`,
which merges the USER_EDITABLE keys into the live config via a new
`applyUserConfig` helper in `lib/config.js` (shared root-expansion logic with
`loadConfig`) and then re-runs `refreshDiscovery`. `POST /api/config` now
calls it after `saveUserConfig`. Covered by `test/engine.test.js` and
`test/config.test.js`.

### H3 — Archived ("shipped") runs vanish from the board once the worktree is gone, despite the archive existing on disk
**User experience:** A `/ship` run reaches `merged`, shows correctly in the
"SHIPPED" group with its plan/scope/timeline. Once its worktree is deleted
(the normal post-merge cleanup this feature explicitly exists to survive),
the card silently reverts to either nothing or a bare "stale branch" card —
no shipped badge, no timeline, no docs, no trace it ever ran. This
contradicts both the Goal ("what recently shipped ... one click away") and
the fixed decision "Archive ship-run state so it survives post-merge
worktree deletion."

**Cause (observed):** `lib/archive.js` correctly snapshots ship-run state and
docs into `~/.claude/shipyard/history/<runId>/`. But nothing in
`lib/engine.js` / `lib/merge.js` ever reads `listArchived()` back into the
`flows` list — it is used only as a docs-lookup fallback (itself broken, see
H1). Once the live worktree disappears, the flow is rebuilt purely from
current git/filesystem state, so the archived record is invisible in the UI.

**Evidence:**
```
# before deletion: flow present, kind=ship, group=shipped
$ curl .../api/flows | jq '.flows[] | {id,kind,group}'
{"id":"05c196e...","kind":"ship","group":"shipped"}

$ rm -rf /tmp/shipyard-scan-.../repo-gamma-wt-shipped   # simulate post-merge cleanup
$ sleep 6   # let a fastTick pass
$ curl .../api/flows | jq '.flows[] | {id,kind,group}'
{"id":"branch:...#feat/shipped-thing","kind":"branch","group":"stale"}
```
The shipped ship-run flow is gone; only a generic stale-branch card with no
history remains. `.../history/<runId>/ship/proof-of-work.md` still exists on
disk the whole time but is unreachable through any UI action.

**Triage: fix-now (task/17-qa-fixes).** `engine.assemble` now appends a
`kind: 'ship'` flow (`group: 'shipped'`) for every archived entry whose runId
isn't currently live, built from `meta.json`, the archived `ship/state.json`
history, and `listDocs` over the archive's `ship/` dir — capped to entries
pinned within the last 7 days, with `statusLine` reading `'abandoned'` for
that fate. Docs resolve through the H1 fix. Covered by `test/engine.test.js`.

## Medium severity

### M1 — `gh` genuinely missing from PATH is reported as "gh not authenticated"
**User experience:** health chip reads "gh ✗ gh not authenticated" even
though `gh` is not installed anywhere on the machine — a user would run
`gh auth login` and be baffled it still fails, instead of learning they need
to install the GitHub CLI at all.
**Evidence:** `lib/collectors/prs.js` `authStatus()` collapses every
`execFile('gh', ...)` failure (including `ENOENT`, i.e. binary not found)
into the fixed string `'gh not authenticated'`.
```
$ which gh; echo $?        # 1, not found
$ dirname $(which gh)      # "no gh" — confirmed truly absent, not just off PATH
$ curl .../api/flows | jq .health.gh
{"ok": false, "reason": "gh not authenticated"}
```
Not fatal — PR features degrade gracefully and the problem is visibly
flagged — but the message actively misdirects troubleshooting.

**Triage: fix-now (task/17-qa-fixes).** `authStatus()` now distinguishes a
spawn `ENOENT` (binary missing) from any other `gh` failure and reports
`'gh not installed'` for the former, `'gh not authenticated'` otherwise.
Covered by `test/prs.test.js`.

### M2 — Invalid JSON in the config file is silently treated as "first run," losing the user's real settings for the session with no error surfaced
**User experience:** A syntactically broken `shipyard.config.json` (e.g. an
accidental edit) produces no error anywhere. The board just shows "first run
— confirm scan roots in the setup panel" with the *default* roots list, as if
the file never existed — the user's actual configured roots (which may have
pointed at real, populated directories) are silently dropped for the
session, with no hint their file is corrupt.
**Evidence:**
```
$ cat .../shipyard.config.json
{ "roots": ["/tmp/shipyard-scan-74UWZ2"], INVALID JSON HERE !!!
$ HOME=... node bin/shipyard --port 4605
shipyard: http://127.0.0.1:4605
first run — confirm scan roots in the setup panel
$ curl .../api/flows | jq .setup
{"created": true, "missingRoots": ["~/Develop","~/dev","~/Projects","~/code"], "roots": []}
```
`lib/config.js` `loadConfig()` swallows the `JSON.parse` failure in a bare
`catch` with no distinct "config is broken" signal — it's indistinguishable
from a genuinely first-ever run.

**Triage: fix-now (task/17-qa-fixes).** `loadConfig` now distinguishes a
missing file (`ENOENT`, genuinely first run) from a present-but-unparsable
one, returning `configError: <message>` (still falling back to defaults so
the board keeps working) instead of folding both cases into `created`.
`bin/shipyard` prints the error, and it's threaded into the engine's `setup`
payload for the UI to surface later. Covered by `test/config.test.js`.

### M3 — Port already taken by another process: silent fallback to a random port, no explanation
**User experience:** If the configured/requested port is already bound by
something else (verified with a plain TCP listener, not another shipyard),
`bin/shipyard` just prints a different, unrelated port with no context —
"shipyard: http://127.0.0.1:46317" instead of the requested 4610. A user with
that port bookmarked, or scripts/aliases pointing at a fixed port, silently
break with zero diagnostic.
**Evidence:**
```
$ node -e "require('net').createServer(s=>s.end()).listen(4610,'127.0.0.1')"  # dummy occupant
$ HOME=... node bin/shipyard --port 4610
shipyard: http://127.0.0.1:46317
```
No mention of port 4610 being unavailable anywhere in stdout or the UI.

**Triage: fix-now (task/17-qa-fixes).** `bin/shipyard` now prints
`` port <configured> is taken by another app — using <bound> `` when it falls
back to an OS-assigned port. Hand-verified (no unit test — see report):
```
$ node -e "require('net').createServer(s=>s.end()).listen(4610,'127.0.0.1')"
$ HOME=<tmp> node bin/shipyard --port 4610
port 4610 is taken by another app — using 33823
shipyard: http://127.0.0.1:33823
first run — confirm scan roots in the setup panel
```

## Low severity

### L1 — New repos/worktrees are invisible for up to 5 minutes, and "Refresh now" does not help
**User experience:** Start a brand-new `/ship` run (new worktree) in an
already-scanned repo, or add a whole new repo under an existing scan root,
open shipyard, click "Refresh now" — the new flow still doesn't appear.
**Evidence:** the visible "Refresh now" button calls only `POST /api/refresh`
→ `engine.refreshNetwork()` (gh/Linear/PR polling), never
`engine.refreshDiscovery()` (which walks scan roots and enumerates
worktrees, and only runs on process start plus every 5 minutes).
```
$ <create repo-gamma with a shipped-phase ship run>
$ curl -s -X POST http://127.0.0.1:4601/api/refresh -H "x-shipyard-token: $T"
{"ok":true}
$ curl -s http://127.0.0.1:4601/api/flows | jq '.flows | length'
2   # repo-gamma still absent; only appeared after a full process restart
```
Reasonable as a background cadence, but the button's label ("Refresh now")
implies it will pick up new work, and it silently doesn't.

**Triage: fix-now (task/17-qa-fixes).** `POST /api/refresh` now calls
`engine.refreshDiscovery()` (which re-walks scan roots) before
`engine.refreshNetwork()`, so "Refresh now" picks up new repos/worktrees
immediately instead of waiting for the 5-minute timer. Hand-verified: a repo
added under a scan root after boot appears in `/api/flows` right after one
`POST /api/refresh`, with no process restart.

### L2 — Torn-write resilience has no upper bound / no visible staleness signal
**User experience:** Once a ship run's `state.json` has been read
successfully at least once, a later *permanent* corruption (not just a
momentary torn write) is masked forever as ordinary stale data — `broken`
can only become true if the state was never successfully read in the first
place (`entry.state` in `lib/collectors/ship.js`'s cache is never reset to
null on a read failure). The flow eventually ages into `failing` / "run
stalled mid-<phase>" once its mtime falls outside the activity threshold, but
never says "state.json unreadable," which is what actually happened.
**Evidence:** truncated `state.json` on an already-running server stayed
`active` / "agent working: implement" across 5 consecutive 5-second ticks
with `broken: false` throughout — confirmed by code review this persists
indefinitely, not just briefly. This matches the project's own unit-test
intent (serve last-known-good), so it reads as a deliberate tradeoff, but it
means genuine permanent corruption is indistinguishable from a live agent
turn until the activity clock alone expires it into a generically-worded
"stalled" state.

**Triage: fix-now (task/17-qa-fixes), partial.** A cached (non-null) ship
state whose `state.json` has failed to read `FAIL_LIMIT` (3) times in a row
now carries a `degraded: [{source: 'ship', reason: 'state.json unreadable —
showing last good state'}]` entry on its flow (wired through
`engine.shipRunsFrom` into `buildFlows`, which copies it onto the flow) — the
degraded chip is visible in the UI immediately rather than only after the
flow eventually ages into `failing`. The underlying tradeoff of continuing to
serve last-known-good `state` while degraded is unchanged by design (matches
the project's own torn-write unit-test intent); only the *visibility* gap
called out here is closed. Covered by `test/engine.test.js`.

## Not independently reproduced / out of scope for this pass

- Did not wait out the real 5-minute discovery interval or 90s network TTL
  to observe their natural firing (reasoned from code + the "Refresh now"
  test in L1 instead, given time budget).
- Did not test with a live `gh`/Linear connection (neither available in this
  environment) — PR/Linear collector *behavior when working* was not
  exercised end-to-end, only their absence/degraded paths.
- Did not test multi-repo GitLab/other-forge PR paths beyond the demo
  fixture's synthetic `degraded` chip.
