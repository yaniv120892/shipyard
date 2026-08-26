# shipyard

A local, single-user web dashboard for everything you have in flight:
`/ship` pipeline runs, open PRs, assigned Linear tasks, ambient git branches,
and local Claude-session activity. It scans the repos under your configured
roots, merges what it finds into one card per flow, and groups the board by
what needs attention — needs you, active, failing, not started, stale,
shipped — so you can see at a glance what to look at next, with the plan,
scope, proof-of-work, PR, and Linear task of any flow one click away.

It's a single Node process with no database and no build step: the
filesystem is the persistence, and `public/index.html` is a plain HTML/JS
page served straight off disk.

To see the board without pointing it at real repos, run it in
[demo mode](#demo-mode) — `node bin/shipyard --demo` opens the same UI
against a fixture board with a handful of sample flows in every group, so
you can explore the layout before ever running it against your own machine.

## Install

```bash
git clone <this-repo>
cd shipyard
node bin/shipyard
```

No `npm install` is required — shipyard is zero-dependency at runtime (the
`eslint`/`prettier` devDependencies are only needed for `npm run lint` /
`npm run format`). The first run creates `~/.claude/shipyard.config.json`
with the defaults below and opens your browser to the board.

To get a `shipyard` command on your `PATH` instead of typing `node
bin/shipyard` every time:

```bash
npm link
shipyard
```

## Config reference

Config lives at `~/.claude/shipyard.config.json`, created on first run from
these defaults and editable by hand (or, for the fields marked below, from
the board's setup panel):

| Key                        | Default                                          | Meaning                                                                                                                                                                          |
| -------------------------- | ------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `port`                     | `4111`                                           | Port the server binds on. **File-only** — not editable from the UI/API; `--port <n>` overrides it for a single launch without changing the file.                                 |
| `roots`                    | `['~/Develop', '~/dev', '~/Projects', '~/code']` | Directories scanned for git repos. `~` expands to your home directory. A root that doesn't exist is dropped and reported in the setup panel instead of failing the scan.         |
| `maxDepth`                 | `6`                                              | How many directory levels are walked under each root while discovering repos.                                                                                                    |
| `activityThresholdMinutes` | `10`                                             | How recently a flow's `/ship` state, docs, or PR must have changed to count as "active"; older than this and past the gate/QA phases it's flagged as waiting or stalled instead. |
| `networkTtlSeconds`        | `90`                                             | How often (seconds) the engine re-polls network-dependent state: `gh` PR status, PR check detail, Linear tasks, and merged/closed fate resolution for archived runs.             |
| `openCommand`              | `'cursor'`                                       | Command invoked by `POST /api/open` to open a doc or worktree path, e.g. `cursor <path>`. **File-only** — not editable from the UI/API.                                          |
| `ignore`                   | `[]`                                             | Array of `repoKey#branchGlob` patterns (branch glob optional, `*` wildcards) to exclude specific flows from the board entirely.                                                  |
| `history.maxEntries`       | `200`                                            | Max number of archived `/ship` runs kept in `~/.claude/shipyard/history/`; oldest (by pin time) are pruned first past this count.                                                |
| `history.maxAgeDays`       | `90`                                             | Archived runs older than this (by pin time) are pruned regardless of count.                                                                                                      |
| `tracker.provider`         | `'linear'`                                       | Which tracker backend to query for assigned tasks. `linear` is the only built-in provider.                                                                                       |
| `tracker.states`           | `[]`                                             | Optional list of Linear state names to show; empty shows every assigned open issue, otherwise only issues in a listed state.                                                     |
| `tracker.cap`              | `50`                                             | Max number of tracker issues fetched per refresh.                                                                                                                                |

`roots`, `ignore`, `tracker`, `activityThresholdMinutes`, `networkTtlSeconds`,
and `history` can also be changed from the board's setup panel (`POST
/api/config`); `port` and `openCommand` require editing the config file
directly and restarting shipyard.

## LINEAR_API_KEY setup

Linear tasks require a personal API key in the `LINEAR_API_KEY` environment
variable:

1. In Linear, go to **Settings → Security & access → API keys** and create a
   personal API key.
2. Export it before launching shipyard: `export LINEAR_API_KEY=lin_api_...`
   (put it in your shell profile so it's set for every future launch).

Without it, the tracker refresh fails silently — no Linear task cards appear,
and `/api/flows`' `health.linear` reports `{ ok: false, reason: "LINEAR_API_KEY
not set" }`. Nothing else on the board is affected.

## Security model

- **Localhost only.** The server binds to `127.0.0.1`, never `0.0.0.0` — it
  is not reachable from other machines on the network.
- **Host header check.** Every request must carry a `Host` header of
  `127.0.0.1`, `localhost`, or either with the bound port; anything else
  (including DNS-rebinding attempts) gets `403`.
- **Token on writes.** A random per-launch token is generated at startup and
  injected into the served `index.html` in place of `__TOKEN__`. Every
  non-`GET` request (`/api/open`, `/api/refresh`, `/api/config`) must send it
  back in the `X-Shipyard-Token` header, or it's rejected with `403`. `GET`
  routes (the board data itself) don't require the token, since they're only
  reachable from localhost in the first place.
- **`/api/open` is path-constrained.** It can only open a path that resolves
  (via `fs.realpathSync` + containment check) inside the requesting flow's
  own worktree or its own archived history directory — it cannot be pointed
  at an arbitrary path elsewhere on disk, including via `..` traversal or
  symlink tricks. It runs `config.openCommand` with that resolved absolute
  path as a single argument via `execFile` (never a shell), so it can't be
  used to inject or chain shell commands. It cannot read file contents back
  to the caller, run arbitrary commands, or write anything — the only other
  filesystem-touching route is `/api/config`, which writes solely to
  `~/.claude/shipyard.config.json` and only the user-editable keys listed
  above.

## Troubleshooting

- **`gh not authenticated`** — `health.gh` in `/api/flows` reports this when
  the `gh` CLI isn't installed or isn't logged in. PR cards, PR check
  status, and merged/closed fate resolution for archived runs are silently
  skipped until you run `gh auth login`; everything else on the board keeps
  working.
- **Empty board** — if the board shows "Scanned N root(s) (...) · 0 flows"
  with an "edit scan roots" link, shipyard found no git repos with a live
  `/ship` run, a non-default branch, an open PR, or a matching Linear task
  under any configured root. Check that `roots` actually contains checked-out
  repos (the setup panel also flags any root that doesn't exist), or widen
  `maxDepth` if your repos are nested deeper than 6 levels down.
- **Port already taken by something else** — the launcher tries the
  configured (or `--port`) port first; if that fails to bind, it retries on
  an OS-assigned free port and prints the URL it actually landed on. Watch
  the terminal output rather than assuming the configured port.
- **"already running" on launch** — a second `shipyard` invocation checks
  `GET /api/health` on the configured port first; if a shipyard instance
  answers there, it prints `shipyard already running at ... — opening it`,
  tries to open your browser to it, and exits `0` without starting a second
  server. If that health check fails (nothing there, or something else is
  listening) it starts a normal new instance instead.

## Demo mode

```bash
node bin/shipyard --demo
```

Boots the same server and UI against a fixed set of fixture flows
(`test/fixtures/demo-flows.json`) instead of scanning the filesystem or
calling `gh`/Linear — one flow in each group (needs you, active, failing,
not started, stale, shipped), so you can see the full board layout, open the
drawer, and read through the columns without a real `/ship` run or repo on
hand. It still honors `--port`, respects the single-instance handoff, and
does not write to `~/.claude/shipyard/history/`.
