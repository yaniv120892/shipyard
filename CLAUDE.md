# shipyard

## Commands

- `npm test` — run the test suite (`node --test`).
- `npm run lint` — eslint over the repo.
- `npm run format` — prettier, writes changes; `npm run format:check` verifies.
- `npm run check` — `node --check` syntax check on server.js, bin/shipyard, and lib/**/*.js.
- `node bin/shipyard` — run the server directly.
- `node scripts/demo.js` — demo mode; arrives in a later task, not yet present.

## Zero runtime dependencies

No npm runtime dependencies. `lib/`, `server.js`, `bin/`, and `public/` may import
only `node:` builtins and local relative files — no bare package imports. This is
enforced by an eslint `no-restricted-imports` regex guard. `devDependencies` are
limited to the shared tooling: `@yaniv120892/dev-config` with its peers `eslint`,
`prettier` and `typescript` (the shared lint config parses through
typescript-eslint), plus `husky` and `lint-staged` for the pre-commit hook. Nothing
else may be added without revisiting this constraint.

## Security invariants

- The server binds `127.0.0.1` only — never `0.0.0.0` or any other host.
- Every non-`GET` request must carry a valid `X-Shipyard-Token` header, checked
  against the server's boot-time token.
- Requests must have a `Host` header on the allowlist (`127.0.0.1:<port>` and
  equivalents); anything else is rejected.
- Child processes are spawned only via `execFile` with an argv array — never
  `exec`, and never with a shell-interpolated string.
- `openCommand` (the editor-open command) is configured only through the
  file-editable config; it is never accepted from a request.

## Dependency direction

`lib/` code must never import `server.js` or anything under `public/`. Data flows
one way: `server.js` and `bin/` depend on `lib/`, not the reverse.

## Pull request checklist

- Every PR must check whether `README.md` needs updating for the change.
- Any PR that changes the UI (`public/index.html`) must refresh the affected
  screenshots in `docs/screenshots/` in that same PR, captured via demo mode
  and Playwright as documented (`node scripts/demo.js`, then drive it with
  Playwright/Chromium).
