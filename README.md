# @firstfive/sdk

Browser SDK for [First Five](https://github.com/SathishAchilles/first-five-sdk), task-based usability studies for builders. One script records **only** two kinds of activity:

- **Setup walk:** the builder walks their own site so First Five can list pages and clickable elements for the goal picker.
- **Consented live task:** a participant who agreed to a study attempts one task. The SDK shows a small task-control widget, reports page views and clicks, and hands the participant back to First Five for feedback.

The SDK talks only to the First Five API. It does nothing for ordinary visitors.

> Status: `0.1.0` on the `next` dist-tag. The First Five API that implements the contract below is being built; the repo includes a mock server for local development.

## Install

Paste the project snippet from First Five into your shared layout, so it loads on every page:

```html
<script
  async
  src="https://YOUR_FIRST_FIVE_HOST/sdk/v1/firstfive.js"
  data-project-id="ffp_123"
></script>
```

| Attribute         | Required | Meaning                                                                                                                      |
| ----------------- | -------- | ---------------------------------------------------------------------------------------------------------------------------- |
| `data-project-id` | yes      | Your public project ID (not a secret)                                                                                        |
| `data-endpoint`   | no       | First Five API origin. Defaults to the script's own origin. **Required** if you load the script from a CDN (unpkg, jsDelivr) |

Or install from npm and start it yourself:

```bash
npm install @firstfive/sdk@next
```

```ts
import { FirstFive } from '@firstfive/sdk';

FirstFive.init({ projectId: 'ffp_123', endpoint: 'https://YOUR_FIRST_FIVE_HOST' });
```

### Mark your important controls

Give primary actions a stable ID so goals keep working when labels change:

```html
<button data-firstfive-id="create_account">Create account</button>
```

| Attribute               | Effect                                                                 |
| ----------------------- | ---------------------------------------------------------------------- |
| `data-firstfive-id`     | Stable element key (otherwise a hash of tag, id, name, label and role) |
| `data-firstfive-label`  | Label to report instead of the visible text                            |
| `data-firstfive-ignore` | Never record this element or anything inside it                        |

### Content Security Policy

If your site sends a CSP header, allow the First Five host:

```
script-src  https://YOUR_FIRST_FIVE_HOST;
connect-src https://YOUR_FIRST_FIVE_HOST;
```

`FirstFive.diagnose()` reports `config_fetch_failed` or `origin_not_allowed` when something blocks it.

## Privacy guarantees

- Nothing is recorded unless the page was opened through a signed First Five setup or study link (or is a reload of one).
- The SDK never reads input values, contenteditable text, or anything inside a form with `autocomplete="cc-*"` fields.
- Routes are reduced to the path. Query strings and fragments are dropped, and IDs, emails, long numbers and tokens become `:id`.
- Labels are cut to 80 characters with emails and long digit runs masked.
- Only `sessionStorage` is used. No cookies, no `localStorage`, no cross-site identifiers.
- The one-time ticket is removed from the address bar immediately.

## API

```ts
FirstFive.init(opts?: { projectId?: string; endpoint?: string }): Promise<void> // idempotent
FirstFive.track(name: string, props?: Record<string, string | number | boolean>): void
FirstFive.diagnose(): Diagnostics // never includes credentials
FirstFive.stop(): void
FirstFive.version: string
```

`track` sends only event names your project allows (for example `signup_completed`). Props are reduced to at most 10 primitive values.

## Wire contract

`src/contracts.ts` holds the exact types; `dev/mock-server.mjs` is an executable reference.

| Call                              | Purpose                                                                                                                                                                   |
| --------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `GET /api/sdk/config?project_id=` | Allowed origins, event allowlists, batch limit, First Five origin                                                                                                         |
| `POST /api/sdk/exchange`          | One-time `#ff_setup=` / `#ff_launch=` ticket (or `?ff_t=&ff_k=`) plus `sdk_version`, exchanged for a short-lived credential                                               |
| `POST /api/sdk/events`            | Batched events (Bearer credential, `X-FirstFive-SDK` header). The ACK carries a **session-level `goal_status`**, which the server evaluates inside the events transaction |
| `POST /api/sessions/:id/end`      | `{reason: finish \| stuck, last_client_sequence}`. Always returns a `feedback_handoff`                                                                                    |
| `POST /api/sdk/setup/finish`      | Ends the setup walk and returns the First Five `return_url`                                                                                                               |

Behaviour the server can rely on:

- **Goal confirmation:** when an ACK says `goal_status: "verified"`, the widget shows "Task complete" with **Continue to feedback**. Continue calls `/end` and follows its `feedback_handoff` (the SDK ignores any handoff inside the ACK).
- **Flush before finish:** finishing waits up to 3 s for queued events to be acknowledged, then sends `/end` with `last_client_sequence`, so the server can tell whether it has every event.
- **At-least-once delivery:** an event can be sent twice (for example when a page navigates mid-request). The server must deduplicate on `event_id`.
- **Errors:** 401 or 410 stop the SDK and show "This test has ended". 429, 5xx and network errors are retried after 1, 2 and 4 s.
- **Redirects:** feedback and return URLs must be on the configured First Five origin.

### Serving the script from First Five

The First Five API should pin `@firstfive/sdk` and serve `node_modules/@firstfive/sdk/dist/firstfive.iife.min.js` at `/sdk/v1/firstfive.js` (and `/sdk/firstfive.js`).

## Limitations

- No session replay, heatmaps or iframe contents.
- Nothing is recorded on pages or domains that don't load the SDK (third-party checkouts, for example).
- Events still queued when a tab closes are lost. The server's deadline finalizes the attempt.
- Discovery lists what the builder actually visited, not every page of the site.

## Develop

```bash
npm install
npm test          # vitest + happy-dom
npm run build     # dist/firstfive.iife.min.js, dist/index.mjs, dist/index.d.ts
npm run dev       # mock API on :5173, demo site on :5174
```

With `npm run dev` running, open `http://localhost:5173/dev/mint?kind=setup` for a setup walk or `http://localhost:5173/dev/mint?kind=live` for a live task. `http://localhost:5173/dev/log` shows what the server received.

## License

MIT
