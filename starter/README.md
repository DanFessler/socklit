# Socklit starter

A shared list. Copy this folder out of the Socklit repo. Point
`socklit` at that repo with `file:` — there is no npm publish yet.

## Copy and run

1. Copy this directory somewhere else.
2. In `package.json`, set the dependency to the Socklit repo on disk
   (absolute path):

```json
"socklit": "file:/ABS/PATH/TO/socklit"
```

Inside this repo the same field is `"file:.."`. Leave that if you
are running from `starter/` here.

3. Install and start:

```bash
npm install
npm run dev
```

4. Open <http://localhost:5173>. That is the only URL. Vite serves
   modules; the HTML is a `listen()` render. Disable JavaScript and
   the page is still there.

If you change `listen({ port })`, change the Vite proxy `target` and
`firstPaint({ port })` in `vite.config.ts` to match.

Two people means two browsers on that origin. The list is the store,
not per-tab state. A second tab on your machine is the same check.

## After a build

```bash
npm run build
npm start
```

`listen({ publicDir: "dist" })` in `src/server.ts` serves the page
and the socket from one process (8787, or `PORT`). HTTPS is still
your reverse proxy, not this process.

## React (optional)

`react` and `react-dom` are optional peers of Socklit. You do not
need them for this list. If you add an island, install them in this
app **and** keep `resolve.dedupe: ["react", "react-dom"]` in
`vite.config.ts` so the replica and the island share one React. Skip
the dedupe and the first mount is an invalid hook call.

## Files

| File | Role |
| --- | --- |
| `src/app.ts` | The UI and the store |
| `src/server.ts` | `listen({ app, subscribe, publicDir })` |
| `src/client.ts` | Loads the replica (do not put app logic or CSS here) |
| `src/styles.css` | The document’s look |
| `index.html` | Must contain `<main id="app">` and `<link>` the stylesheet |

You import `socklit/server` and `socklit/client`. You do not import
files from inside the Socklit repo.
