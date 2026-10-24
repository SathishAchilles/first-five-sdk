# First Five SDK v1: MVP implementation plan

Status: MVP-trimmed (Opus scope review, 2026-10-24); awaiting user approval to start T1.
Source of truth: `First_Five_PRD_v1_1.md` §5, §6.1–6.2, §12, §12.1, §12.2 plus corrections C1–C5 (C10: Demo B is P1).
Estimated effort: about 9.75 focused hours.

## 0. Scope

IN: browser SDK, wire-contract types, mock server + dev host page, unit and integration tests (happy-dom), one CI job, the GitHub repo, a manual npm publish.
OUT: Render API, Postgres, PostHog forwarding, AgenticOrg, Pine Labs and the First Five UI. The SDK talks **only to the Render API**; posthog-js is not bundled (PRD §4, §7.4).

## 1. Decisions (locked by the user, 2026-10-24)

| ID  | Decision                                                                                                                                                                                                 |
| --- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| D1  | SDK-only repo `SathishAchilles/first-five-sdk` (repo root = package root)                                                                                                                                |
| D2  | Public                                                                                                                                                                                                   |
| D3  | `@firstfive/sdk` on npmjs; the user creates the free npm org `firstfive`. T1 checks the scope first (the npm website check returned 403, so it's inconclusive; the registry has no `@firstfive/sdk` yet) |
| D5  | MIT                                                                                                                                                                                                      |
| D6  | `0.1.0`, `npm publish --tag next`; promote to `latest` once Render implements the contract                                                                                                               |

## 2. Tech

- TypeScript strict, **zero runtime deps**.
- `tsup` outputs:
  - `dist/firstfive.iife.min.js` — the `<script>` build, global `FirstFive`, auto-init
  - `dist/index.mjs` + `dist/index.d.ts` — the npm build
  - **No CJS.**
- Tests: `vitest` + `happy-dom`. No Playwright in v0.1; a scripted manual smoke test replaces it (T8).
- Lint: `typescript-eslint` recommended (not type-checked) + `prettier --check` + `tsc --noEmit`.
- Node **22** (`.nvmrc`); Node 20 reached end of life on 2026-04-30. No `engines` field.
- Size: print `gzip -c dist/firstfive.iife.min.js | wc -c` at checkpoint 1; target ≤ 15 KB.
- `package.json`: `"exports": { ".": { "types": "./dist/index.d.ts", "import": "./dist/index.mjs" }, "./iife": "./dist/firstfive.iife.min.js" }`, `"files": ["dist"]`. **Do not** set `"sideEffects": false`, because auto-init has side effects. Contract types are exported from the root entry.

## 3. Repository layout

```
first-five-sdk/
  package.json  tsconfig.json  tsup.config.ts  vitest.config.ts  eslint.config.js
  .prettierrc  .gitignore  .nvmrc (22)  LICENSE (MIT)  README.md
  .github/workflows/ci.yml          # one job: ci, typecheck, lint, test, build
  docs/plans/first-five-sdk-v1-plan.md
  src/
    index.ts        # public API, idempotent init, currentScript capture, auto-init
    version.ts      # SDK_VERSION (tsup define)
    contracts.ts    # wire types (§5)
    config.ts  state.ts  storage.ts  ids.ts  sanitize.ts
    handoff.ts      # fragment/query ticket → exchange → strip → sessionStorage
    transport.ts    # batching, single in-flight, ACK dedup, retry, flush, pagehide persist
    track/pageview.ts  track/click.ts  track/form.ts  track/custom.ts
    discovery.ts    # setup scan + MutationObserver (C5)
    goal.ts         # ACK goal_status → GOAL_CONFIRMED (C2)
    finalize.ts     # idempotent requestEnd: flush → /end → redirect (C3)
    setup.ts        # setup finish + return (C4)
    widget/widget.ts  widget/styles.ts
    diagnose.ts
  test/unit/*.test.ts  test/integration/*.test.ts
  dev/mock-server.mjs  dev/demo-host/{index,signup,dashboard}.html
```

## 4. Public API

```ts
FirstFive.init(opts?: { projectId?: string; endpoint?: string }): Promise<void>   // idempotent; auto-runs from the script tag
FirstFive.track(name: string, props?: Record<string, string | number | boolean>): void
FirstFive.diagnose(): Diagnostics
FirstFive.stop(reason?: string): void
FirstFive.version: string
```

- Capture `document.currentScript` **synchronously at module top level**. Fall back to `querySelector('script[data-project-id]')`.
- The endpoint defaults to the script `src` origin. `data-endpoint` overrides it, and is **required** if the IIFE is ever loaded from a CDN.

## 5. Wire contract (`src/contracts.ts`)

This is the contract the Render API must implement; the mock server in T8 is its executable version.

| Call                                                                  | Request                                                     | Response                                                                                                                                                                                                                                               |
| --------------------------------------------------------------------- | ----------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `GET /api/sdk/config?project_id=`                                     | —                                                           | `{status, allowed_origins[], events_url, event_allowlist[], custom_event_allowlist[], max_batch_events, first_five_origin}`                                                                                                                            |
| `POST /api/sdk/exchange`                                              | `{project_id, ticket, kind:"setup"\|"live", sdk_version}`   | `{credential, expires_at, mode, session_id: string\|null, study_id: string\|null, task_text?, deadline_at?}`                                                                                                                                           |
| `POST /api/sdk/events` (Bearer + header `X-FirstFive-SDK: <version>`) | `{batch_id, events: CanonicalEvent[]}` (PRD §5.6)           | `{accepted:[event_id], rejected:[{event_id, code}], last_acked_sequence, goal_status:"pending"\|"verified"}` **(C2)**. `goal_status` is **session-level**, sent on every live ACK, and **evaluated inside the events transaction** (a MUST for Render) |
| `POST /api/sessions/:id/end` (Bearer)                                 | `{reason:"finish"\|"stuck", last_client_sequence}` **(C3)** | `{outcome:"completed"\|"dropped"\|"finalizing", feedback_handoff:{url, expires_at}}`. It **always** returns a handoff, even while Render holds its ≤10 s grace window                                                                                  |
| `POST /api/sdk/setup/finish` (Bearer)                                 | `{last_client_sequence}`                                    | `{return_url}` (must start with `first_five_origin`)                                                                                                                                                                                                   |

How the SDK reacts:

| Response                  | SDK behaviour                                                                     |
| ------------------------- | --------------------------------------------------------------------------------- |
| 401 or 410                | `STOPPED`, credential cleared, widget shows "ended"                               |
| 429, 5xx or network error | retry after 1 s, 2 s, 4 s, then keep the events queued for the next flush trigger |
| anything else             | `degraded=true` plus `last_error_code`                                            |

The SDK no longer uses: the `/status` endpoint, `goal_hint`, or the `feedback_handoff` in the ACK. If Render sends the handoff, the SDK ignores it; "Continue" calls `/end` instead. (This differs from C2's literal wording, so the README documents it.)

## 6. State machine (`src/state.ts`)

```
UNINITIALIZED → CONFIG_LOADING → READY
READY → SETUP_ACTIVE → SETUP_FLUSHING → SETUP_FINISHED → READY                 (C4)
READY → LIVE_ACTIVE → GOAL_CONFIRMED                                           (C2)
LIVE_ACTIVE | GOAL_CONFIRMED → FLUSHING → TASK_FINALIZING → FEEDBACK_HANDOFF → STOPPED   (C3)
ANY ACTIVE → STOPPED   (401/410, expiry, stop())
```

- Implemented as `Record<State, State[]>`. An illegal transition is logged and ignored.
- `degraded` is a flag, not a state.
- Event listeners are attached only in `SETUP_ACTIVE`, `LIVE_ACTIVE` and `GOAL_CONFIRMED`.

## 7. Module specs

1. **config.ts**
   - `data-project-id` is required; if it's missing, log one console warning and stay `UNINITIALIZED`.
   - Fetch the config with a 5 s `AbortController` timeout.
   - If the page origin isn't in `allowed_origins`, stay `READY` and set diagnostic `origin_not_allowed` (A03, A06).
2. **handoff.ts**
   - Read the ticket from `#ff_setup=` / `#ff_launch=`, falling back to the query `?ff_t=&ff_k=setup|live`.
   - Exchange it once, sending `sdk_version`.
   - **Always** strip the ticket with `history.replaceState`, keeping any other hash or query parts.
   - Store the credential in `sessionStorage` at `ff:cred:<project_id>` and restore it on reload while unexpired (A08). Use no localStorage or cookies.
3. **ids.ts**: `crypto.randomUUID()` with a `getRandomValues` fallback. A monotonic `client_sequence` persisted at `ff:seq:<session_id>`, which C3's grace check depends on.
4. **sanitize.ts**
   - `normalizeRoute`: pathname only, with the query and hash always dropped. Segments that look like a UUID, a run of ≥4 digits, an email or a token longer than 24 chars become `:id`. Lowercase, no trailing `/`.
   - `safeLabel`: the first of `aria-label`, `data-firstfive-label`, `innerText`, `title`, `alt`. Collapse whitespace, cut to 80 chars, mask emails and runs of ≥4 digits.
   - `elementKey`: `data-firstfive-id`, otherwise `auto:`+fnv1a(tag|id|name|label|role).
   - **Never** read `.value` or contenteditable text.
5. **transport.ts**
   - Flush at 10 events or after 2 s, capped at `max_batch_events`. **One request in flight** at a time.
   - Event IDs that have been ACKed are dropped and never resent. Retry after 1 s, 2 s, 4 s. The queue is capped at 500 (the oldest are dropped).
   - Every fetch has a 5 s `AbortController` timeout.
   - `flush(timeoutMs) → Promise<{ackedThrough:number, timedOut:boolean}>`.
   - **On `pagehide`, write the unsent queue to `sessionStorage` at `ff:q:<session_id>`, and drain it on the next page's init. On `visibilitychange:hidden`, try a normal flush.** No sendBeacon.
   - ACK hook: when `goal_status==="verified"`, call `goal.onVerified()`.
6. **track/pageview.ts**: fire on load, `pushState`, `replaceState` and `popstate`. Wrap the history methods (call the original first, never throw). Skip if the route is the same as the last one (A05).
7. **track/click.ts**: one capture-phase listener on `document`. Use `closest('button,a[href],[role=button],input[type=submit],input[type=button],[data-firstfive-id]')`. Skip anything inside `[data-firstfive-ignore]`, the widget host, or a form with `autocomplete^=cc-`. Never call `preventDefault` or `stopPropagation`.
8. **track/form.ts**: capture-phase `submit`; emits `ff_form_submitted` with a `form_key`. It never reads values.
9. **track/custom.ts**: the event name must be in `custom_event_allowlist`. Keep only string, number and boolean props, cut to 80 chars, and silently drop the rest.
10. **discovery.ts** (setup mode only, C5)
    - `ff_page_viewed` on every page view, including pages with zero elements.
    - `scanPage()` emits `ff_element_discovered` for eligible elements, skipping `[hidden]`, `[aria-hidden=true]`, and `display:none` / `visibility:hidden` (no zero-size check).
    - Dedup per page load, with a cap of 200 per route.
    - A `MutationObserver` with a 500 ms debounce rescans the current route; this is needed so that SPA pushState doesn't scan the old DOM.
    - Clicked and discovered are separate events (A04).
11. **goal.ts (C2)**: `onVerified()` moves to `GOAL_CONFIRMED` and the widget shows "Task complete ✓ · [Continue to feedback]", with no Finish button. Continue calls `requestEnd("finish")`. After a reload, the first ACK restores `GOAL_CONFIRMED`.
12. **finalize.ts (C3)**: `requestEnd(reason)` is **idempotent**: a double click or Stuck-then-Finish sends exactly one `/end`.
    1. Move to `FLUSHING` ("Saving…").
    2. `await flush(3000)`.
    3. `POST /end` with `{reason, last_client_sequence}`, retrying after 1 s, 2 s, 4 s. If it still fails, show "Couldn't save · Return to First Five".
    4. Check that `feedback_handoff.url` starts with `first_five_origin`.
    5. Clear the credential, move to `FEEDBACK_HANDOFF`, call `location.assign`, then `STOPPED`.
13. **setup.ts (C4)**
    - The banner reads "First Five setup walk · N pages · M elements · [Finish setup]".
    - Finish: `SETUP_FLUSHING` → `flush(3000)` → `/setup/finish` (same retries and error UI as `/end`) → check `return_url` → clear the credential → redirect.
    - If the credential expires, the banner shows "Setup session expired · Return to First Five".
14. **widget/**: one Shadow DOM host `<first-five-widget>`, fixed bottom-right, `z-index:2147483000`, no larger than 320×200. The states are:
    - **live**: task text plus **I'm stuck** and **Finish test**
    - **confirm**: "End the test?" Yes / No
    - **saving**
    - **complete**
    - **ended**: "This test has ended · Return to First Five", for 401/410
    - **error**
    - **setup banner**

    All controls are real `<button>`s with a visible focus style, plus an `aria-live="polite"` status line.

15. **diagnose.ts**: returns `{version, project_id, mode, state, endpoint, origin_allowed, last_acked_sequence, degraded, last_error_code}`. It never includes the credential.

## 8. Tests (happy-dom, vitest), mapped to the acceptance tests

| Test                                                                                                                                       | Covers                  |
| ------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------- |
| No events in READY or from a wrong origin                                                                                                  | A03, A06                |
| Exchange strips the URL, binds `session_id`, and sends `sdk_version`                                                                       | A07                     |
| Reload restores the credential and keeps the sequence going                                                                                | A08                     |
| Reused or expired ticket → 410 → STOPPED, then the ended or expired UI                                                                     | A28                     |
| ACKed IDs are never resent; the sequence is monotonic across a simulated reload; the queue drains after pagehide                           | A12                     |
| `pushState` gives one view and no duplicate                                                                                                | A05                     |
| An unclicked button is discovered, not clicked; a page with zero elements still emits a page view; the observer rescans after a SPA render | A04, C5                 |
| A verified ACK shows the complete state without Finish; a reload restores GOAL_CONFIRMED                                                   | A26                     |
| A goal click, then Finish within 200 ms → `/end` only after the flush ACK, with a matching `last_client_sequence`                          | A27                     |
| Stuck → `reason:"stuck"` → redirect; a double Finish sends one `/end`; a foreign handoff or `return_url` is rejected                       | A10, A09 (SDK side), C4 |
| Sanitizer masking; a spy on the `.value` getter is never called                                                                            | PRD §2.8                |
| `/end` 5xx×3 → the error UI with a recovery link                                                                                           | Missing #3              |

Test stubs: `location.assign` is stubbed. Labels are asserted through `aria-label` / `data-firstfive-label` because `innerText` in happy-dom is approximate.

## 9. Tasks

| #   | Task                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                | Done when                                                                | Hours |
| --- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------ | ----- |
| T1  | `git init -b main`; check the npm scope (`npm view @firstfive/sdk`, org availability); add the config files from §2 and §3                                                                                                                                                                                                                                                                                                                                                                                                          | `npm run build` emits the IIFE, mjs and d.ts                             | 0.5   |
| T2  | `contracts`, `ids`, `storage`, `sanitize` + unit tests                                                                                                                                                                                                                                                                                                                                                                                                                                                                              | Masking passes; the `.value` spy is never called                         | 1.0   |
| T3  | `state`, `config`, `handoff` + integration tests                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    | A03, A06, A07, A08, A28 pass                                             | 1.25  |
| T4  | `transport` + tests with fake timers                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                | A12 and the flush-bound tests pass                                       | 1.25  |
| T5  | `track/*` + `discovery` + tests                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     | A05, A04 and C5 pass                                                     | 1.25  |
| T6  | `widget`, `goal`, `finalize`, `setup` + integration tests                                                                                                                                                                                                                                                                                                                                                                                                                                                                           | A26, A27, A10, C4, idempotency and error UI pass                         | 1.75  |
| T7  | `index.ts` (API, `currentScript` capture, auto-init) + `diagnose`; build and gzip check                                                                                                                                                                                                                                                                                                                                                                                                                                             | `window.FirstFive.version` exists in the IIFE; ≤15 KB gz printed         | 0.5   |
| T8  | Mock server (`config`, `exchange`, `events` with a `page_reached` goal check, `end` that always returns a handoff, `setup/finish`, `/dev/mint?kind=`, stub `/feedback` and `/projects/x/discovery` pages, CORS preflight with `Access-Control-Max-Age`) + dev host (index, signup form with `data-firstfive-id="create_account"`, dashboard, one pushState link). **Scripted manual smoke test in Chrome and Safari:** setup walk → return; live → goal → Continue; live → stuck; reload mid-task; MPA click just before navigating | Every step is observed and the mock log shows the sequences and outcomes | 1.25  |
| T9  | README (snippet, `data-*` attributes, CSP `script-src`/`connect-src`, privacy, contract table → `src/contracts.ts` incl. the C2 note, limitations, how Render serves `/sdk/v1/firstfive.js` from the pinned package) + `ci.yml` (one job, Node 22: `npm ci && npm run typecheck && npm run lint && npm test && npm run build`)                                                                                                                                                                                                      | Passes locally                                                           | 0.5   |
| T10 | **CHECKPOINT 1: show the user** the file tree, test summary mapped to the A-tests, gzip size, lint and typecheck output, and smoke results                                                                                                                                                                                                                                                                                                                                                                                          | The user approves the push                                               | —     |
| T11 | `gh repo create SathishAchilles/first-five-sdk --public --source . --remote origin`; commit with the attribution trailer; `git push -u origin main`                                                                                                                                                                                                                                                                                                                                                                                 | CI is green                                                              | 0.25  |
| T12 | **CHECKPOINT 2: npm publish.** The user creates the `firstfive` org and runs `! npm login`. Then `npm pack --dry-run` (only dist, README and LICENSE ship) → `npm publish --access public --tag next` → `npm view @firstfive/sdk@next version` → `npm dist-tag ls @firstfive/sdk` → fetch the unpkg IIFE URL                                                                                                                                                                                                                        | 0.1.0 resolves on `next`                                                 | 0.25  |

If time runs short, drop in this order: the Safari smoke test, then the query-fallback parser, then `form`/`custom` (only if the goal is `page_reached`; record it as debt), then the banner counters.

## 10. Deferred to v0.2

- `ff_activity` and `ff_client_error` (P1)
- `hashchange` tracking and a query allowlist
- Playwright e2e on Chromium and WebKit
- size-limit in CI
- `release.yml` with npm trusted publishing and provenance
- CJS build, `contracts` subpath, CHANGELOG
- Widget collapse, theming and reduced-motion support
- Byte-based batching, 413 batch splitting, retry jitter
- sendBeacon
- A local deadline timer
- Promoting `next` to `latest`

## 11. Risks from the cuts

1. **No browser automation.** Shadow DOM and Safari quirks are only smoke-tested. Mitigation: smoke-test once on a real external page (for example a Lovable app) before the demo.
2. **The synchronous ACK contract.** If Render evaluates goals asynchronously, A26 breaks silently (Finish still works). "Goal evaluated inside the `/events` transaction" goes into the Render plan as a MUST.
3. **Events lost on tab close.** Events still queued when the tab closes are lost; the server deadline finalizes the session as dropped, which PRD §5.7 accepts. The dashboard can flag it as `incomplete_tracking`.
4. **Continue → `/end` differs from C2's literal wording.** It's documented in the README contract table.
5. **No local deadline timer.** An idle tab updates only on its next 410.
6. **No provenance on the first publish.** Acceptable for `next`; add trusted publishing before `latest`.
7. **`--tag next` on the first publish may also set `latest`.** Verify with `npm dist-tag ls` at T12.
8. **The recommended lint misses floating promises.** Use explicit `void`/`await` and the ordering tests in T6.
9. **No zero-size filter in discovery** adds noise to the list; the builder confirms goals, so outcomes aren't affected.

## Haiku Validation

Every task names the exact files, contract fields, state names, limits (10 events / 2 s / 500 queue / 1-2-4 s retry / 3 s flush / 5 s fetch timeout / 200 per route / 80 chars), commands and the check that marks it done. Haiku can carry out T1–T9 one after another with no design decisions, and must stop at T10 and T12 for user approval.
