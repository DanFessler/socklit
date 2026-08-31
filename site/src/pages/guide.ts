import { component, html } from "socklit/server";

import { snippet } from "../code";

const INSTALL = `{
  "dependencies": {
    "socklit": "file:<path-to-this-repo>"
  }
}`;

const DEV = `npm install
npm run dev`;

const LISTEN = `import { listen } from "socklit/server";
import { App, store } from "./app";

await listen({
  app: () => App({ store }),
  subscribe: (onChange) => store.onChange(() => onChange(store)),
});`;

const PATH = `await listen({
  createApp: (session) => () => App({ path: session.params.get("path") ?? "/" }),
});`;

const COMPONENT = `import { component, html } from "socklit/server";

export const App = component(function App() {
  return html\`<h1>Hello</h1>\`;
});

App({})`;

const TAG = `component.tag("TodoRow", (props: { todo: Todo }) => {
  return html\`<li>\${props.todo.text}</li>\`;
});

html\`<TodoRow .todo=\${todo}></TodoRow>\``;

const EVENTS = `html\`
  <form
    @submit=\${(event: SubmitPayload) => {
      const text = event.fields["title"] ?? "";
    }}
  >
    <input name="title" required />
    <button type="submit">Add</button>
  </form>

  <input
    type="checkbox"
    .checked=\${item.done}
    @change=\${(event: ChangePayload) => {
      const checked = event.checked ?? false;
    }}
  />

  <button type="button" ?disabled=\${item.qty <= 0} @click=\${() => take(item.id)}>
    Take
  </button>
\``;

const SESSION_HANDLER = `@click=\${(_event, session) => {
  if (!session.user) return;
  remove(item.id, session.user);
}}`;

const KEYED = `html\`<ul>
  \${keyed(
    items,
    (item) => item.id,
    (item) => html\`<li>\${item.title}</li>\`,
  )}
</ul>\``;

const STORE = `export const store = await createJsonStore<Item[]>({
  file: "data/items.json",
  initial: () => [],
  parse: parseItems,
});

export const App = component(function App(props: { store: typeof store }) {
  const items = useStore(props.store).state;
  return html\`…\`;
});

void props.store.mutate((current) => ({
  next: [...current, item],
  result: undefined,
}));`;

const CHANGE_SOURCE = `export const source = changeSource();

await listen({
  app: () => App({}),
  subscribe: (onChange) => watch(() => onChange(source)),
});`;

const IDENTIFY = `function identify(request: IdentifyRequest): Member | null {
  const token = sessionToken(request);
  if (!token) return null;
  return verifyTicket<Member>(token, secret);
}

await listen({
  identify,
  createApp: (session) => () => App({ store, user: session.user }),
  subscribe: (onChange) => store.onChange(() => onChange(store)),
});`;

const GRANT = `@submit=\${(event: SubmitPayload, session) => {
  const name = event.fields["name"]?.trim() ?? "";
  const member = MEMBERS.find((row) => row.name === name);
  if (!member) return;
  session.grant(signTicket({ id: member.id, name: member.name }, secret));
}}`;

const REFUSE = `@click=\${(_event, session) => {
  const actor = session.user;
  if (!actor || actor.id !== piece.authorId) return;
  void store.mutate((current) => ({
    next: current.filter((row) => row.id !== piece.id),
    result: undefined,
  }));
}}`;

const ISLAND_CONTRACT = `import { defineIsland } from "socklit/server";

export const StaffPicker = defineIsland<
  { people: { id: string; name: string }[]; value: string | null },
  { onPick: (id: string) => void }
>("StaffPicker");`;

const ISLAND_MOUNT = `html\`<mount
  .Island=\${StaffPicker}
  .people=\${STAFF}
  .value=\${loan.borrowerId}
  .onPick=\${(id: string, session) => assign(loan.id, id, session.user)}
></mount>\``;

const ISLAND_CLIENT = `import { registerIsland } from "socklit/client";
import { StaffPicker } from "./staff-picker.island";

registerIsland("StaffPicker", StaffPicker);

import "socklit/client";`;

export const Guide = component(function Guide() {
  return html`
    <header class="page-head">
      <p class="kicker">Getting started</p>
      <h1>Install the runtime. Write a component next to the data.</h1>
      <p class="lede">
        Socklit is a server-authoritative UI runtime. You write components
        that run next to your data. The browser is a replica: it paints the
        templates it is given and sends clicks back as addresses. There is
        no REST handler for a button.
      </p>
    </header>

    <section class="prose">
      <h2>Install and run</h2>
      <p>
        Until the package is published, point at this repository. Copy
        <code>starter/</code>, then in that app’s <code>package.json</code>:
      </p>
      ${snippet(INSTALL, "json")}
      ${snippet(DEV, "bash")}
      <p>
        Open <a href="http://localhost:5173">http://localhost:5173</a>. That
        is the only URL. Vite serves modules; the HTML is a
        <code>listen()</code> render (<code>firstPaint</code> in
        <code>vite.config.ts</code>). Disable JavaScript and the page is
        still there.
      </p>
      <p>
        If you change <code>listen({ port })</code>, change the Vite proxy
        <code>target</code> and <code>firstPaint({ port })</code> in
        <code>vite.config.ts</code> to match. After
        <code>npm run build</code>,
        <code>listen({ publicDir: "dist" })</code> serves the page and the
        socket from one process (<code>npm start</code>). HTTPS is still
        your reverse proxy, not this process.
      </p>
      <p>
        You import the framework as <code>socklit/server</code>. You do not
        import files from inside the Socklit repo. Edit
        <code>src/app.ts</code>, save, refresh if the replica does not
        hot-replace the tree.
      </p>

      <h2>Your first files</h2>
      <table>
        <thead>
          <tr>
            <th>File</th>
            <th>Role</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td><code>src/app.ts</code></td>
            <td>The UI and, if you have one, the store</td>
          </tr>
          <tr>
            <td><code>src/server.ts</code></td>
            <td><code>listen({ app, subscribe })</code></td>
          </tr>
          <tr>
            <td><code>src/client.ts</code></td>
            <td>Loads the replica. Do not put app logic or CSS here.</td>
          </tr>
          <tr>
            <td><code>src/styles.css</code></td>
            <td>The document’s look. <code>@import</code> socklit/client/styles.css</td>
          </tr>
          <tr>
            <td><code>index.html</code></td>
            <td>Must contain <code>&lt;main id="app"&gt;</code> and <code>&lt;link&gt;</code> the stylesheet</td>
          </tr>
        </tbody>
      </table>
      <p>
        The starter is already a shared list. <code>app.ts</code> creates
        the store and the component. <code>server.ts</code> is the wiring:
      </p>
      ${snippet(LISTEN)}
      <p>
        <code>useState</code> is this tab only. Open a second tab on the
        starter: an add appears in both. That is the store +
        <code>subscribe</code> line, not <code>useState</code>.
      </p>

      <h2>The URL</h2>
      <p>
        The replica puts the page path on the socket as
        <code>session.params.get("path")</code>. Vite (and
        <code>listen({ publicDir })</code> after a build) serves
        <code>index.html</code> for paths that are not a real file, so a
        reload of <code>/compare</code> still boots the replica. The HTML
        is already a <code>listen()</code> render of that path. Your app
        switches on it:
      </p>
      ${snippet(PATH)}
      <p>
        That is not a router. <code>&lt;a href="/compare"&gt;</code> is a
        real navigation: new page, new socket, same bootstrap, different
        path. <code>session.params</code> is also the rest of the URL
        query (<code>?mine=1</code> is a filter you chose). Anyone can
        edit it. It is not how you know who is connected — that is
        <code>session.user</code>.
      </p>

      <h2>Components</h2>
      <p>A component takes one props object and returns <code>html\`…\`</code>.</p>
      ${snippet(COMPONENT)}
      <p>
        Call it as a function: <code>App({})</code>. That is the typed
        spelling. A function call can pass another template as a
        <strong>named</strong> prop
        (<code>TodoRow({ todo, extra: html\`…\` })</code>).
      </p>

      <h3>Templates</h3>
      <p>
        <code>html</code> is lit-html. Three prefixes, plus an interpolation:
      </p>
      <table>
        <thead>
          <tr>
            <th>You write</th>
            <th>Meaning</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td><code>\${value}</code></td>
            <td>A value (text, a nested template, a component, a handler)</td>
          </tr>
          <tr>
            <td><code>@click=\${fn}</code></td>
            <td>An event. Also <code>@change</code>, <code>@submit</code>.</td>
          </tr>
          <tr>
            <td><code>.checked=\${bool}</code></td>
            <td>A DOM property.</td>
          </tr>
          <tr>
            <td><code>?disabled=\${bool}</code></td>
            <td>A boolean HTML attribute (<code>disabled</code>, <code>hidden</code>).</td>
          </tr>
        </tbody>
      </table>
      <p>
        Do not put <code>.value=</code> on a text field you want the user
        to keep typing into — every render will snap it back.
      </p>

      <h3>Tags (optional)</h3>
      <p>
        <code>html</code> tags are strings, not identifiers. To write
        <code>&lt;TodoRow .todo=\${todo}&gt;</code> you must claim the name:
      </p>
      ${snippet(TAG)}
      <p>
        The string is the catalog key, not a name scraped off the function.
        A tag is <strong>not type-checked</strong>. Every prop must be a
        named binding (<code>.todo=\${todo}</code>), not a static
        attribute. A tag does not take children — there is no unnamed
        slot between the tags. Nest through a named prop on the function
        call instead. Prefer <code>TodoRow({ todo })</code> when you want
        the checker.
      </p>

      <h2>Events</h2>
      <p>Handlers are server closures. The browser sends a small payload.</p>
      ${snippet(EVENTS)}
      <ul>
        <li>
          <code>@submit</code> → <code>event.fields</code>:
          <code>Record&lt;string, string&gt;</code>. Every value is a
          <strong>string</strong>, including
          <code>&lt;input type="number"&gt;</code>.
        </li>
        <li><code>@change</code> → <code>value</code> and/or <code>checked</code>.</li>
        <li><code>@click</code> → just the click.</li>
      </ul>
      <p>The second argument is the session that acted:</p>
      ${snippet(SESSION_HANDLER)}
      <p>Do not <code>preventDefault</code> — there is no DOM in the handler.</p>
      <p>
        <strong>Native constraint validation can skip your handler.</strong>
        If the browser blocks the submit (<code>required</code>,
        <code>min</code>, <code>type="number"</code>), <code>@submit</code>
        never runs. A <code>useState</code> error from an earlier attempt
        will stay on screen until you clear it. Validate again on the
        server; do not assume the handler saw the click.
      </p>

      <h2>Forms and drafts</h2>
      <p>The replica paints the template. It does not own the typing caret.</p>
      <ul>
        <li>
          An input <strong>without</strong> <code>.value=</code> /
          <code>value=</code> keeps whatever the user typed across a
          re-render. That is how the add field stays filled while someone
          else mutates the list.
        </li>
        <li>
          An input <strong>with</strong> <code>value="1"</code> or
          <code>.value=\${n}</code> snaps back to that value on every
          render. After a rejected submit, the field looks wiped if you
          bound it that way.
        </li>
        <li>
          There is no public “draft” helper. <code>useState</code> on this
          tab is the usual place for a flash message. The other tab will
          not see it.
        </li>
      </ul>

      <h2>Lists</h2>
      <p>
        A list needs a stable identity per row. A plain JavaScript array
        in <code>\${…}</code> is refused so an insert or delete cannot
        reuse the wrong <code>useState</code> or the wrong closures. Wrap
        the collection:
      </p>
      ${snippet(KEYED)}
      <p>
        <code>keyed([])</code> is legal and renders nothing. For an empty
        state, branch on <code>items.length</code> and omit the list (the
        starter does this). The key must be stable. Do not use the array
        index if the list can reorder or delete.
      </p>

      <h2>Shared state</h2>
      <p>Three different things, not a binary:</p>
      <ul>
        <li>
          <strong>This tab.</strong> <code>useState</code> — open/closed
          chrome, flash messages.
        </li>
        <li>
          <strong>This source.</strong> <code>useStore(source)</code> —
          every connected replica that read that object re-renders when
          it changes. Not “the internet”; the sessions on this process
          that subscribed.
        </li>
        <li>
          <strong>A person you computed.</strong>
          <code>session.user</code>. A guest and a member can share a
          source and still paint different trees.
        </li>
      </ul>
      <p>
        Socklit does not own the database. Three names must agree:
        <code>useStore(source)</code>,
        <code>listen({ subscribe })</code>, and
        <code>onChange(source)</code> — the same object in all three.
        The starter is the whole recipe. The store <em>is</em> the source:
      </p>
      ${snippet(STORE)}
      ${snippet(LISTEN)}
      <p>
        <code>createJsonStore</code> is a local default — a JSON file
        behind a mutex — not the product database.
        <code>result</code> is the value of the Promise
        (<code>await store.mutate(…)</code>). The replica never reads it.
      </p>
      <ul>
        <li>Do not mutate <code>store.state</code>. Return a replacement from <code>mutate</code>.</li>
        <li>Returning the same reference from <code>mutate</code> is a no-op (no write, no notify).</li>
        <li>
          Two <code>mutate</code> calls at once are serialized. Last
          completed write wins; there is no automatic merge.
        </li>
      </ul>
      <p>
        If you already have a listener, you do not need
        <code>createJsonStore</code>. Hold a <code>changeSource()</code>,
        call <code>useStore(source)</code> when you read, and notify with
        that same object:
      </p>
      ${snippet(CHANGE_SOURCE)}

      <h2>Who is connected</h2>
      <p>
        <code>session.user</code> is a value <strong>you</strong> computed
        on the server, or <code>null</code> if the tab is signed out. An
        app that refuses a write reads that value inside the handler —
        not the URL, not whether a button was painted.
      </p>
      <h3>1. Look the token up when the socket connects</h3>
      ${snippet(IDENTIFY)}
      <p>
        Read <code>session.user</code> <strong>inside</strong> the render
        function. Do not close over <code>user</code> once in
        <code>createApp</code>. Throw from <code>identify</code> to
        refuse the socket. <code>signTicket</code> /
        <code>verifyTicket</code> survive a process restart. A
        <code>Map</code> of tickets dies.
      </p>
      <h3>2. Issue a token from a sign-in handler</h3>
      <p>
        <code>grant</code> tells the replica to <code>POST /session</code>.
        <code>listen</code> sets an HttpOnly cookie on the page origin.
        The socket stays up; <code>useState</code> is not wiped. Refresh
        stays signed in. <strong>Every tab in that browser is the same
        person.</strong> Two people means two browsers (or a private
        window).
      </p>
      ${snippet(GRANT)}
      <p>
        <code>session.revoke()</code> drops the token and reidentifies on
        the same socket, signed out. OAuth, SSO, and a users table are
        still your problem. Socklit binds the connection to a user you
        already trust.
      </p>
      <h3>3. Refuse at the write, not at the button</h3>
      <p>
        Painting a control is not permission. A click can arrive late or
        from a tab that should not have the button:
      </p>
      ${snippet(REFUSE)}

      <h2>Islands</h2>
      <p>
        An ordinary control is a server template. If it needs a
        <strong>browser DOM that cannot wait for a round trip</strong> —
        typeahead that filters as you type, drag-and-drop, a focus-trapped
        popover — it is an island. The contract is hand-written. Three
        pieces. The name is the same string in all three.
      </p>
      <h3>1. Contract (imported by the server only)</h3>
      ${snippet(ISLAND_CONTRACT)}
      <p>
        Props are JSON. Callbacks are top-level (<code>onPick</code>), not
        nested in a config object.
      </p>
      <h3>2. Placement in a server template</h3>
      ${snippet(ISLAND_MOUNT)}
      <p>
        Or <code>mount(StaffPicker, { people, value, onPick })</code>. Do
        not write <code>&lt;StaffPicker&gt;</code> — that would look like a
        server component. The React side still calls <code>onPick(id)</code>.
        The runtime appends the acting session. Do not close over
        <code>user</code> from the last render — ask
        <code>session.user</code> when the pick arrives.
      </p>
      <h3>3. React implementation, registered on the client</h3>
      <p>
        Install <code>react</code> and <code>react-dom</code> in the app
        <strong>and</strong> keep one copy — the starter Vite config already
        has <code>resolve.dedupe: ["react", "react-dom"]</code>. Set
        <code>"jsx": "react-jsx"</code> in <code>tsconfig.json</code>.
      </p>
      ${snippet(ISLAND_CLIENT)}
      <p>
        The two import graphs must not mix: the server never imports the
        <code>.island.tsx</code> file. The island never imports
        <code>useStore</code> or <code>html</code>.
      </p>

      <h2>What this surface does not include</h2>
      <ul>
        <li>Deployment, sticky sessions, HTTPS, a production process manager</li>
        <li>
          OAuth, SSO, password hashing, a users table — you issue tokens;
          <code>identify</code> binds them to the connection
        </li>
        <li>File uploads, streaming, raw SQL helpers</li>
        <li>A type-checker for <code>&lt;TodoRow&gt;</code> tags</li>
        <li>The research probes and protocol inspector (those are the lab, not the product)</li>
      </ul>

      <h2>If something fails</h2>
      <ul>
        <li>
          <strong>Page empty.</strong> <code>listen</code> is down, or the
          Vite proxy <code>target</code> does not match
          <code>{ port }</code>. Same-origin is the product path.
          <code>?ws=</code> is only for a replica that is not behind that
          proxy — cookies will not cross that hop.
        </li>
        <li>
          <strong><code>missing #app</code>.</strong>
          <code>index.html</code> must have an element with
          <code>id="app"</code>.
        </li>
        <li>
          <strong><code>plain array</code>.</strong> You put a JavaScript
          array in <code>\${…}</code>. Use <code>keyed</code> so each
          row keeps a stable identity.
        </li>
        <li>
          <strong>Screen goes stale after a store write.</strong>
          <code>subscribe</code> is missing, or <code>useStore</code> was
          not called with the same store object.
        </li>
        <li>
          <strong>Unknown tag <code>&lt;Foo&gt;</code>.</strong> Nothing
          called <code>component.tag("Foo", …)</code>, or that module was
          never imported.
        </li>
        <li>
          <strong><code>unknown island: Name</code>.</strong> The client
          never called <code>registerIsland("Name", …)</code>, or the name
          does not match <code>defineIsland</code>.
        </li>
        <li>
          <strong>Signed in, refresh is a guest.</strong>
          <code>identify</code> did not find the cookie
          (<code>sessionToken(request)</code>). The <code>Map</code> died
          with the process, or you are still reading
          <code>params.user</code>.
        </li>
        <li>
          <strong>Two tabs are different people.</strong> You opened with
          <code>?ws=</code> (the fallback is per-tab). Same origin shares
          the cookie.
        </li>
      </ul>
    </section>
  `;
});
