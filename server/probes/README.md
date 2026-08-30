# Writing a probe

A probe is a contrived application whose purpose is to force an architectural
decision. See [`research/design-probes.md`](../../research/design-probes.md) for
the register of decisions and which probe forces which.

Probes are developed independently and in parallel. The rules below exist so
that several probes can be built at once without touching the same files.

## Layout

```
server/probes/<id>/probe.ts     required, exports create()
server/probes/<id>/*.ts         anything else the probe needs
data/<id>/*.json                durable state, created on demand
test/probes/<id>.test.ts        tests
research/probes/<id>.md         findings write-up, required
```

Discovery is by directory scan, so there is no registry file to edit. Drop the
directory in and the probe appears at `?probe=<id>`.

## The contract

```ts
import type { Probe, ProbeContext } from "../types";

export async function create(context: ProbeContext): Promise<Probe> {
  // Boot-time work: load stores, seed data, start simulators.
  return {
    id: "<id>",                       // must equal the directory name
    title: "Human readable",
    forces: "S3, A2",                 // register entries from design-probes.md
    subscribe: (listener) => ...,     // optional: shared state changed
    createApp: (session) => ({ app }) // per connection
  };
}
```

**Shared versus per-session state.** `create` runs once; `createApp` runs per
connection. Anything a single user can diverge on — a route, an open menu, a
selected tab, their identity — belongs to state created inside `createApp`, and
changes to it are published with `session.invalidate()`, which re-renders only
that session. Shared state lives in a store and is published through
`subscribe`, which re-renders everyone.

A store can narrow that. If it names itself as the change source when it
notifies — `listener(this)` — the runtime skips every session whose last render
did not read it, and `useStore(store)` inside a component is the call that
records the read. Both halves are needed, and they match on object identity: the
value passed to `useStore` must be the same object the store notifies with.
Nothing verifies that, and a mismatch does not throw — the session simply stops
updating — so a probe that opts in should have a test that mutates the store and
asserts an update. For the same reason, declare either every read a probe makes
or none of them: the first `useStore` call a session performs switches off the
fallback that treats a render declaring nothing as reading everything. A store
that names nothing re-renders everyone exactly as before, so this is opt-in per
store rather than something a probe has to adopt.

`session.params` carries the WebSocket query string, so a probe can be
configured per tab: `?probe=ledger&user=alice`. Handlers receive the acting
session as a second argument — `(payload, session)` — so a handler can resolve
who acted from its arguments instead of capturing it at render time.

## Persistence

Use `JsonStore` from `server/json-store.ts`. It gives atomic writes, a mutation
mutex, change listeners, and a no-op short circuit when a mutation returns the
current value by reference. Do not write files directly; the atomic-rename retry
logic in there exists because Windows intermittently fails the rename.

```ts
const store = await createJsonStore<Ledger>({
  file: context.dataFile("ledger.json"),
  initial: () => ({ entries: [] }),
  parse: (raw) => validate(raw),
});
```

## Authoring rules

These are the prototype's real constraints. Hitting one is a finding, not a bug
to work around.

- A hole may be a string, number, boolean, `null`, a nested `html` template, a
  `keyed()` list, an event handler, a `focusWhen()` request, or an
  `island.mount()`. Everything else is rejected.
- `focusWhen(active)` must sit in element position, as in
  ``html`<div ${focusWhen(open)}>…</div>` ``, because the element it focuses is
  the one carrying the hole; anywhere else it throws in the browser. It is a
  transition rather than a value: the client focuses that element on the render
  where `active` turns true and does nothing on the renders either side of it.
  Moving focus to the same element twice without it going inactive in between
  needs a bumped `focusWhen(true, nonce)`.
- Collections **must** go through `keyed(items, keyOf, render)`. A plain array
  throws. Keys must be stable and unique.
- Not supported: `unsafeHTML`, directives, dynamic tag names, spread
  attributes, `svg`/`mathml` templates.
- Use `.checked=${value}` rather than `?checked=`, so the server can correct a
  control the user already touched.
- **Handlers must express intent, not a delta relative to what the user saw.**
  `setDone(id, true)` is safe to apply late, twice, or concurrently;
  `toggle(id)` is not, because two clients asking for the same outcome cancel
  out. Event payloads carry the user's intent — use it.
- Handlers re-check their own preconditions against the store. Rendering a
  control is not authorization.

## Files you must not edit

Several probes are being built at once, so these are owned by the coordinator:

```
shared/protocol.ts      server/runtime.ts      server/serialize.ts
server/diff.ts          server/keyed.ts        server/index.ts
server/metrics.ts       server/json-store.ts   server/store.ts
client/**               package.json           tsconfig.json
research/design-probes.md
```

If your probe cannot be built without changing one of them, **stop and report
it**. That is the most valuable result a probe can produce: it means the probe
found a genuine architectural limit rather than an inconvenience. Describe what
you needed, why, and what you would propose — do not implement it.

Adding new files outside your directory is fine (`scripts/`, `test/probes/`).

## Verifying

```bash
npm run typecheck
npx vitest run test/probes/<id>.test.ts
```

The server hosts every probe at once on `ws://localhost:8787`; open
`http://localhost:5182/?probe=<id>`. Per-probe measurements are at
`http://localhost:8787/metrics`, which reports microseconds per node for render
plus diff, retained bytes per session, bytes sent by message kind, and the
renders read scoping avoided.

The client's Latency control simulates a round trip per tab, and
`?latency=400` sets it from the URL. Use it: several constraints in this
architecture are invisible at localhost latency.

## The findings write-up

`research/probes/<id>.md` is the actual deliverable. The app is only the
instrument. Include:

1. **What the probe does** and how to run it.
2. **Measurements**, from `/metrics` and from the latency readout. Numbers, not
   impressions.
3. **What it forced.** For each register entry in your `forces` field, what the
   probe revealed and what you would decide.
4. **Where you hit a wall**, if you did, and what you would propose.
5. **What a reader should not conclude** — the ways this contrived app is
   unrepresentative.

Write plainly and lead with the result. Do not restate the architecture; assume
the reader has read `design-probes.md`.
