export type CatalogStatus = "shipped" | "planned";

export type CatalogEntry = {
  id: string;
  name: string;
  module: "socklit/server" | "socklit/client";
  signature: string;
  meaning: string;
  example?: string;
  status: CatalogStatus;
};

export type CatalogSection = {
  id: string;
  title: string;
  intro: string;
  entries: string[];
};

/** Side-nav order. Every catalog id belongs to exactly one section. */
export const API_SECTIONS: CatalogSection[] = [
  {
    id: "templates",
    title: "Templates",
    intro:
      "You write html`…`. A component is a function that returns that. Call it as a function when you want the type checker. A tag is optional sugar for the same call: named bindings for properties, no children yet.",
    entries: [
      "html",
      "component",
      "component.tag",
      "keyed",
      "RenderOutput",
      "ComponentFactory",
      "ComponentOptions",
    ],
  },
  {
    id: "hooks",
    title: "Hooks",
    intro:
      "useState is this tab — chrome and flash messages. useStore records that this session read a source. useRef never schedules a render. Context is provide(value, within), not a provider element.",
    entries: ["useState", "useStore", "useRef", "createContext", "useContext"],
  },
  {
    id: "store",
    title: "Store",
    intro:
      "Socklit does not own the database. Three names must agree: useStore(source), listen({ subscribe }), and onChange(source) — the same object. createJsonStore is a local default, a JSON file behind a mutex.",
    entries: [
      "changeSource",
      "createJsonStore",
      "JsonStore",
      "JsonStoreOptions",
      "StoreError",
      "ChangeListener",
    ],
  },
  {
    id: "host",
    title: "Host",
    intro:
      "listen() starts the session protocol. Getting-started is one URL: Vite proxies /ws, /session, and /health to this process. After a build, publicDir serves the page next to the socket.",
    entries: ["listen", "ListenOptions", "ListenHandle", "listen.origin"],
  },
  {
    id: "session",
    title: "Session",
    intro:
      "session.user is a value you computed, or null. Look the token up in identify, issue it with grant, refuse inside the write. The URL query is a filter you chose — path, ?mine=1 — not a person. Two people means two browsers.",
    entries: [
      "identify",
      "sessionToken",
      "grant",
      "revoke",
      "signTicket",
      "verifyTicket",
      "SessionHandle",
      "SessionContext",
      "IdentifyRequest",
      "parseCookies",
      "SESSION_COOKIE",
      "SESSION_QUERY",
    ],
  },
  {
    id: "islands",
    title: "Islands",
    intro:
      "A control that cannot wait for the wire — typeahead, drag, a focus-trapped popover. The contract is hand-written. Same name in three places: defineIsland, the <mount>, and registerIsland. The server never imports the .island.tsx file.",
    entries: [
      "defineIsland",
      "mount",
      "slot",
      "IslandServerEvents",
      "IslandEvents",
      "registerIsland",
    ],
  },
  {
    id: "events",
    title: "Events",
    intro:
      "The browser sends a small payload, not a DOM event. There is no preventDefault. The second argument is the session that acted. Native constraint validation can skip @submit entirely — validate again on the server.",
    entries: [
      "SubmitPayload",
      "ChangePayload",
      "ClickPayload",
      "KeyPayload",
      "FocusPayload",
      "EventPayload",
    ],
  },
];

const SECTION_IDS = new Set(API_SECTIONS.flatMap((section) => section.entries));

export function groupCatalog(entries: CatalogEntry[]): {
  id: string;
  title: string;
  intro: string;
  entries: CatalogEntry[];
}[] {
  const byId = new Map(entries.map((entry) => [entry.id, entry]));
  return API_SECTIONS.map((section) => ({
    id: section.id,
    title: section.title,
    intro: section.intro,
    entries: section.entries.flatMap((id) => {
      const entry = byId.get(id);
      return entry ? [entry] : [];
    }),
  })).filter((section) => section.entries.length > 0);
}

/**
 * Every public export from `socklit/server` and `socklit/client`, plus
 * names we can add when the files exist. Planned entries are not imports.
 */
export const CATALOG: CatalogEntry[] = [
  {
    id: "html",
    name: "html",
    module: "socklit/server",
    signature: "html(strings: TemplateStringsArray, ...values: unknown[]): TemplateResult",
    meaning:
      "The template language. Static segments intern once; ${} bindings carry values and handlers. Write markup, interpolate with ${}, bind events with @click / @change / @submit, properties with .checked=, and HTML booleans with ?disabled=. There is no JSX on the server.",
    example: `html\`
  <button type="button" ?disabled=\${empty} @click=\${() => take(id)}>
    Take
  </button>
\``,
    status: "shipped",
  },
  {
    id: "component",
    name: "component",
    module: "socklit/server",
    signature: "component<P>(fn: (props: P) => RenderOutput, options?: ComponentOptions): ComponentFactory<P>",
    meaning:
      "Wraps a function so it is a component: one props object, returns html`…`. Call it as a function — App({ store }) — which is the typed spelling. The runtime assigns an address before the body runs, so useState and useRef hang off that instance. A nested tree is a named RenderOutput prop you interpolate, not children.",
    example: `export const Row = component(function Row(props: { title: string }) {
  return html\`<li>\${props.title}</li>\`;
});

Row({ title: "Milk" })`,
    status: "shipped",
  },
  {
    id: "component.tag",
    name: "component.tag",
    module: "socklit/server",
    signature: "component.tag<P>(name: string, fn: (props: P) => RenderOutput, options?: ComponentOptions): ComponentFactory<P>",
    meaning:
      "Claims a PascalCase catalog key so a template may write <TodoRow .todo=${todo}></TodoRow>. The string is the key, not a name scraped off the function. A tag is not type-checked. Every prop must be a named binding (.todo=${todo}). A tag does not take children — nest through a named prop on the function call. Prefer TodoRow({ todo }) when you want the checker.",
    example: `component.tag("TodoRow", (props: { todo: Todo }) => {
  return html\`<li>\${props.todo.text}</li>\`;
});

html\`<TodoRow .todo=\${todo}></TodoRow>\``,
    status: "shipped",
  },
  {
    id: "keyed",
    name: "keyed",
    module: "socklit/server",
    signature:
      "keyed<T>(items: Iterable<T>, keyOf: (item: T, index: number) => string | number, render: (item: T, index: number) => RenderOutput): KeyedList",
    meaning:
      "Wraps a collection so the replica can keep per-row identity. A plain JavaScript array in ${} is refused so an insert or delete cannot reuse the wrong row. keyed([]) is legal and renders nothing; for an empty state, branch on length and omit the list. The key must be stable — do not use the index if the list can reorder or delete.",
    example: `html\`<ul>
  \${keyed(
    items,
    (item) => item.id,
    (item) => html\`<li>\${item.title}</li>\`,
  )}
</ul>\``,
    status: "shipped",
  },
  {
    id: "useState",
    name: "useState",
    module: "socklit/server",
    signature: "useState<T>(initial: T | (() => T)): [T, (next: T | ((prev: T) => T)) => void]",
    meaning:
      "State owned by the server, scoped to one component instance in one browser tab. Dies with the socket. A setter schedules a server render, so the user sees the result one round trip later. Use it for open/closed chrome and flash messages — not for a shared source.",
    example: `const [error, setError] = useState("");
if (!title) {
  setError("Title is required");
  return;
}`,
    status: "shipped",
  },
  {
    id: "useStore",
    name: "useStore",
    module: "socklit/server",
    signature: "useStore<T>(store: T): T",
    meaning:
      "Reads shared authoritative state and records that this session read it. Returns the store itself. The object you pass must be the same object listen({ subscribe }) notifies with — useStore(store), then onChange(store). A session that did not read a store is skipped when that store changes.",
    example: `export const App = component(function App(props: { store: typeof store }) {
  const items = useStore(props.store).state;
  return html\`<p>\${items.length} items</p>\`;
});`,
    status: "shipped",
  },
  {
    id: "useRef",
    name: "useRef",
    module: "socklit/server",
    signature: "useRef<T>(initial: T | (() => T)): { current: T }",
    meaning:
      "A per-instance cell that survives renders and never schedules one. Use it for a value that changes because a render happened (a counter, a last-seen snapshot). Nothing should read a ref to decide what to paint — a ref changing produces no new frame.",
    example: `const renders = useRef(0);
renders.current += 1;`,
    status: "shipped",
  },
  {
    id: "createContext",
    name: "createContext",
    module: "socklit/server",
    signature: "createContext<T>(name: string, fallback: T): Context<T>",
    meaning:
      "Creates a named context with a fallback. Provide a value with context.provide(value, within) around a subtree. The name is for diagnostics. Like React context, but the stack lives on the server for this render.",
    example: `const Theme = createContext("Theme", "default");

Theme.provide("high-contrast", Page({}));

const theme = useContext(Theme);`,
    status: "shipped",
  },
  {
    id: "useContext",
    name: "useContext",
    module: "socklit/server",
    signature: "useContext<T>(context: Context<T>): T",
    meaning:
      "Reads the nearest provided value, or the fallback if nothing provided one. Exempt from hook slot ordering — it retains nothing. Passing a handle that did not come from createContext() throws.",
    status: "shipped",
  },
  {
    id: "createJsonStore",
    name: "createJsonStore",
    module: "socklit/server",
    signature: "createJsonStore<T>(options: JsonStoreOptions<T>): Promise<JsonStore<T>>",
    meaning:
      "A JSON file behind a mutex, with atomic writes. file is relative to the process working directory. parse rejects or repairs whatever is on disk. This is a default persistence, not the product — any object you can subscribe to is a store. Gitignore data/; parent directories are created on first write.",
    example: `export const store = await createJsonStore<Item[]>({
  file: "data/items.json",
  initial: () => [],
  parse: parseItems,
});`,
    status: "shipped",
  },
  {
    id: "JsonStore",
    name: "JsonStore",
    module: "socklit/server",
    signature: "class JsonStore<T> { readonly state: T; mutate<R>(apply: (state: T) => { next: T; result: R }): Promise<R>; onChange(listener: () => void): () => void }",
    meaning:
      "The store createJsonStore returns. Do not mutate state; return a replacement from mutate. The same reference is a no-op (no write, no notify). result is the Promise value — the replica never reads it; undefined is fine. Two mutate calls are serialized; last completed write wins.",
    example: `void store.mutate((current) => {
  const row = current.find((item) => item.id === id);
  if (!row || row.ownerId) return { next: current, result: undefined };
  return {
    next: current.map((item) =>
      item.id === id ? { ...item, ownerId: actor.id } : item,
    ),
    result: undefined,
  };
});`,
    status: "shipped",
  },
  {
    id: "StoreError",
    name: "StoreError",
    module: "socklit/server",
    signature: "class StoreError extends Error",
    meaning:
      "Thrown for invalid input or an unknown record. parse should throw StoreError so a corrupt file never rewrites the store. The error never leaves the file half-written.",
    example: `if (typeof id !== "string" || typeof title !== "string") {
  throw new StoreError("invalid item");
}`,
    status: "shipped",
  },
  {
    id: "JsonStoreOptions",
    name: "JsonStoreOptions",
    module: "socklit/server",
    signature: "type JsonStoreOptions<T> = { file: string; initial: () => T; parse: (raw: unknown) => T; serialize?: (value: T) => unknown }",
    meaning:
      "Constructor options for createJsonStore. initial is used when the file does not exist. serialize defaults to the value itself.",
    status: "shipped",
  },
  {
    id: "listen",
    name: "listen",
    module: "socklit/server",
    signature: "listen<User>(options: ListenOptions<User>): Promise<ListenHandle>",
    meaning:
      "Starts the session protocol: WebSocket /ws, POST /session, GET /health. Pass app for one render function, or createApp(session) when the tree depends on the connection (route, identity). subscribe tells the runtime when shared state changed. publicDir serves a built page next to the socket after vite build. Default port is 8787, or PORT, or { port }.",
    example: `await listen({
  app: () => App({ store }),
  subscribe: (onChange) => store.onChange(() => onChange(store)),
  publicDir: "dist",
});`,
    status: "shipped",
  },
  {
    id: "identify",
    name: "identify",
    module: "socklit/server",
    signature: "identify?: (request: IdentifyRequest) => User | null | Promise<User | null>",
    meaning:
      "Option on listen, not a standalone function. Called when the socket connects. Return a user the server computed, or null if signed out. Throw to refuse the socket. Read sessionToken(request) — cookie first, then the query fallback when the replica used ?ws=. session.user is whatever you returned.",
    example: `function identify(request: IdentifyRequest): Member | null {
  const token = sessionToken(request);
  if (!token) return null;
  return verifyTicket<Member>(token, secret);
}

await listen({
  identify,
  createApp: (session) => () => App({ store, user: session.user }),
  subscribe: (onChange) => store.onChange(() => onChange(store)),
});`,
    status: "shipped",
  },
  {
    id: "sessionToken",
    name: "sessionToken",
    module: "socklit/server",
    signature: "sessionToken(request: { cookies: Record<string, string>; params: URLSearchParams }): string | null",
    meaning:
      "Reads the opaque session token: HttpOnly cookie first, then socklit_session on the query string when the page could not share a cookie (?ws=). It is the string you passed to grant, not a user id. Look it up in identify.",
    status: "shipped",
  },
  {
    id: "grant",
    name: "grant",
    module: "socklit/server",
    signature: "session.grant(token: string): void",
    meaning:
      "On SessionHandle. Give this browser a token. The replica POSTs /session; listen sets an HttpOnly cookie on the page origin. This connection re-identifies; the tab’s useState and islands stay. Every tab in that browser is then the same person. Two people means two browsers.",
    example: `@submit=\${(event: SubmitPayload, session) => {
  const name = event.fields["name"]?.trim() ?? "";
  const member = MEMBERS.find((row) => row.name === name);
  if (!member) return;
  session.grant(signTicket({ id: member.id, name: member.name }, secret));
}}`,
    status: "shipped",
  },
  {
    id: "revoke",
    name: "revoke",
    module: "socklit/server",
    signature: "session.revoke(): void",
    meaning:
      "On SessionHandle. Drops the cookie (or the ?ws= fallback token) and re-identifies this connection as signed out. The socket stays up.",
    example: `@click=\${(_event, session) => session.revoke()}`,
    status: "shipped",
  },
  {
    id: "SessionHandle",
    name: "SessionHandle",
    module: "socklit/server",
    signature: "type SessionHandle<User> = { id: string; params: URLSearchParams; user: User | null; grant: (token: string) => void; revoke: () => void }",
    meaning:
      "What a handler learns about the session that acted. Passed as the second argument to @click and as the last argument to an island callback. user is whatever identify returned — refuse a write by reading it. params is the URL query (path, ?mine=1), a filter you chose, not a person.",
    example: `@click=\${(_event, session) => {
  const actor = session.user;
  if (!actor || actor.id !== piece.authorId) return;
  void store.mutate((current) => ({
    next: current.filter((row) => row.id !== piece.id),
    result: undefined,
  }));
}}`,
    status: "shipped",
  },
  {
    id: "SessionContext",
    name: "SessionContext",
    module: "socklit/server",
    signature: "type SessionContext<User> = SessionHandle<User> & { invalidate: () => void }",
    meaning:
      "What createApp receives: the handle plus invalidate(), which re-renders only this session. Use it for per-tab chrome that is not a store write. Handlers do not get invalidate — whatever they changed will render on its own.",
    example: `createApp: (session) => () =>
  App({ path: session.params.get("path") ?? "/", user: session.user }),`,
    status: "shipped",
  },
  {
    id: "IdentifyRequest",
    name: "IdentifyRequest",
    module: "socklit/server",
    signature: "type IdentifyRequest = { params: URLSearchParams; headers: IncomingHttpHeaders; cookies: Record<string, string> }",
    meaning:
      "What identify receives. params is the WebSocket URL query. cookies is the parsed Cookie header, set by POST /session after grant.",
    status: "shipped",
  },
  {
    id: "ListenOptions",
    name: "ListenOptions",
    module: "socklit/server",
    signature:
      "type ListenOptions<User> = { app?: () => RenderOutput; createApp?: CreateApp<User>; identify?: …; subscribe?: (listener: ChangeListener) => () => void; publicDir?: string; port?: number; onLog?: (message: string) => void }",
    meaning:
      "listen() takes app or createApp, not both. subscribe should call listener(store) so useStore(store) can skip sessions that did not read it. publicDir is a built-files directory (usually dist/) served next to the socket.",
    status: "shipped",
  },
  {
    id: "ListenHandle",
    name: "ListenHandle",
    module: "socklit/server",
    signature: "type ListenHandle = { port: number; close: () => Promise<void> }",
    meaning:
      "The running protocol. port is the bound port. close disposes sessions and shuts the HTTP and WebSocket servers.",
    status: "shipped",
  },
  {
    id: "ChangeListener",
    name: "ChangeListener",
    module: "socklit/server",
    signature: "type ChangeListener = (source?: unknown) => void",
    meaning:
      "Notified when shared state changes. source identifies what changed so the runtime can skip sessions that did not read it. Omitting source re-renders every session — the old unconditional behavior, and still safe.",
    status: "shipped",
  },
  {
    id: "parseCookies",
    name: "parseCookies",
    module: "socklit/server",
    signature: "parseCookies(header: string | undefined): Record<string, string>",
    meaning:
      "Parses a Cookie header into a name → value map. listen already does this for identify. Export it if you handle HTTP yourself.",
    status: "shipped",
  },
  {
    id: "SESSION_COOKIE",
    name: "SESSION_COOKIE",
    module: "socklit/server",
    signature: 'const SESSION_COOKIE: "socklit_session"',
    meaning:
      "Cookie name for the opaque session token. HttpOnly, SameSite=Lax, Path=/. Not a user id.",
    status: "shipped",
  },
  {
    id: "SESSION_QUERY",
    name: "SESSION_QUERY",
    module: "socklit/server",
    signature: "const SESSION_QUERY: typeof SESSION_COOKIE",
    meaning:
      "Query-string name for the same token. Used when the replica cannot set a cookie (?ws= cross-origin). Same string as SESSION_COOKIE.",
    status: "shipped",
  },
  {
    id: "defineIsland",
    name: "defineIsland",
    module: "socklit/server",
    signature: "defineIsland<P, E>(name: string): IslandHandle<P, E>",
    meaning:
      "Declares a client widget the server may place: a name, JSON props, top-level callbacks. The React implementation lives in a *.island.tsx file the server never imports. The name must be an identifier and must match registerIsland on the client.",
    example: `export const StaffPicker = defineIsland<
  { people: { id: string; name: string }[]; value: string | null },
  { onPick: (id: string) => void }
>("StaffPicker");`,
    status: "shipped",
  },
  {
    id: "mount",
    name: "mount",
    module: "socklit/server",
    signature: "mount<P, E>(island: IslandHandle<P, E>, props: P & IslandServerEvents<E>, well?: SlotWell): IslandMount",
    meaning:
      "Places an island in a template. Write <mount .Island=${Name} .prop=${value} .onPick=${handler}></mount>, or call mount(Name, { … }). Do not write <Name> — that would look like a server component. Callbacks are typed as the island args plus session.",
    example: `html\`<mount
  .Island=\${StaffPicker}
  .people=\${STAFF}
  .value=\${loan.borrowerId}
  .onPick=\${(id, session) => assign(loan.id, id, session.user)}
></mount>\``,
    status: "shipped",
  },
  {
    id: "slot",
    name: "slot",
    module: "socklit/server",
    signature: "slot(content: RenderOutput): SlotWell",
    meaning:
      "Marks a server tree as a well for mount(), not as a child and not as a prop. The island cannot read it. The replica keeps painting it. Pass it as the third argument to mount(), not as a prop. You do not need a slot for a typeahead that is JSON in, callback out.",
    example: `html\`<mount .Island=\${Picker}>
  <slot>\${Row({ item })}</slot>
</mount>\``,
    status: "shipped",
  },
  {
    id: "IslandServerEvents",
    name: "IslandServerEvents",
    module: "socklit/server",
    signature: "type IslandServerEvents<E> = { [K in keyof E]: (...args: [...Args<E[K]>, SessionHandle]) => Return<E[K]> }",
    meaning:
      "What you write next to <mount>: the island's callbacks with the acting session appended. The React side still calls onPick(id). The runtime adds session, the same second argument @click already gets.",
    status: "shipped",
  },
  {
    id: "IslandEvents",
    name: "IslandEvents",
    module: "socklit/server",
    signature: "type IslandEvents = { readonly [name: string]: (...args: never[]) => unknown }",
    meaning:
      "Callbacks as the island sends them — JSON arguments only. Nested functions in a config object are refused at serialize time.",
    status: "shipped",
  },
  {
    id: "SubmitPayload",
    name: "SubmitPayload",
    module: "socklit/server",
    signature: 'type SubmitPayload = { kind: "submit"; fields: Record<string, string> }',
    meaning:
      "What @submit receives. Every field value is a string, including <input type=\"number\">. Native constraint validation (required, min, type=number) can skip the handler entirely — the browser never submits. Validate again on the server.",
    example: `@submit=\${(event: SubmitPayload) => {
  const title = event.fields["title"]?.trim() ?? "";
  if (!title) return;
  add(title);
}}`,
    status: "shipped",
  },
  {
    id: "ChangePayload",
    name: "ChangePayload",
    module: "socklit/server",
    signature: 'type ChangePayload = { kind: "change"; value?: string; checked?: boolean }',
    meaning:
      "What @change receives. value and/or checked, depending on the control. There is no DOM in the handler; do not preventDefault.",
    example: `html\`<input
  type="checkbox"
  .checked=\${item.done}
  @change=\${(event: ChangePayload) => setDone(item.id, event.checked ?? false)}
/>\``,
    status: "shipped",
  },
  {
    id: "ClickPayload",
    name: "ClickPayload",
    module: "socklit/server",
    signature: 'type ClickPayload = { kind: "click" }',
    meaning:
      "What @click receives: just the click. The interesting argument is usually the second one — the SessionHandle that acted.",
    example: `@click=\${(_event, session) => {
  if (!session.user) return;
  remove(item.id);
}}`,
    status: "shipped",
  },
  {
    id: "KeyPayload",
    name: "KeyPayload",
    module: "socklit/server",
    signature: 'type KeyPayload = { kind: "key"; key: string; alt: boolean; ctrl: boolean; meta: boolean; shift: boolean; repeat: boolean }',
    meaning:
      "One key press, named rather than coded. key is KeyboardEvent.key (Escape, ArrowDown, a). Modifiers travel with it. Bind @key on an element; it is not a document-level shortcut.",
    example: `@key=\${(event: KeyPayload) => {
  if (event.key === "Escape") close();
}}`,
    status: "shipped",
  },
  {
    id: "FocusPayload",
    name: "FocusPayload",
    module: "socklit/server",
    signature: 'type FocusPayload = { kind: "focus" } | { kind: "blur" }',
    meaning:
      "Focus entered or left the element carrying this handler. Carries nothing else — the server learns that focus moved, not where it went.",
    status: "shipped",
  },
  {
    id: "EventPayload",
    name: "EventPayload",
    module: "socklit/server",
    signature: "type EventPayload = ClickPayload | ChangePayload | SubmitPayload | KeyPayload | FocusPayload",
    meaning:
      "Sanitized, transport-safe description of a browser interaction. Handlers receive a payload, not a DOM event.",
    status: "shipped",
  },
  {
    id: "ComponentFactory",
    name: "ComponentFactory",
    module: "socklit/server",
    signature: "type ComponentFactory<P> = ((props: P) => ComponentMarker) & { readonly tag: string | undefined }",
    meaning:
      "The function component() returns. Calling it produces a marker, not a template — serialization runs the body once the address is known.",
    status: "shipped",
  },
  {
    id: "ComponentOptions",
    name: "ComponentOptions",
    module: "socklit/server",
    signature: "type ComponentOptions = { name?: string }",
    meaning:
      "Optional name used in diagnostics. Inferred from the function name when omitted.",
    status: "shipped",
  },
  {
    id: "RenderOutput",
    name: "RenderOutput",
    module: "socklit/server",
    signature: "type RenderOutput = TemplateResult | ComponentMarker | ProvidedValue",
    meaning:
      "What a component may return: a lit-html template, another component, or a provided context subtree.",
    example: `export const Shell = component(function Shell(props: {
  path: string;
  children: RenderOutput;
}) {
  return html\`<div class="page">\${props.children}</div>\`;
});

Shell({ path, children: body })`,
    status: "shipped",
  },
  {
    id: "registerIsland",
    name: "registerIsland",
    module: "socklit/client",
    signature: "registerIsland(name: string, component: ComponentType<Record<string, unknown>>): void",
    meaning:
      "Registers the React implementation for a defineIsland name. Call it from the client entry before importing socklit/client. The two import graphs must not mix: the server never imports the .island.tsx file; the island never imports useStore or html. Keep one React — Vite resolve.dedupe: [\"react\", \"react-dom\"].",
    example: `import { registerIsland } from "socklit/client";
import { StaffPicker } from "./staff-picker.island";

registerIsland("StaffPicker", StaffPicker);

import "socklit/client";`,
    status: "shipped",
  },
  {
    id: "changeSource",
    name: "changeSource",
    module: "socklit/server",
    signature: "changeSource(): ChangeSource",
    meaning:
      "A unique object for useStore(source) and onChange(source). Socklit does not own your database. createJsonStore is one implementation that notifies as itself.",
    example: `export const source = changeSource();

await listen({
  app: () => App({}),
  subscribe: (onChange) => watch(() => onChange(source)),
});`,
    status: "shipped",
  },
  {
    id: "signTicket",
    name: "signTicket",
    module: "socklit/server",
    signature: "signTicket(payload: Record<string, unknown>, secret: string): string",
    meaning:
      "HMAC-SHA256 ticket for grant. Pass your own secret. A Map of tickets dies with the process; a signed ticket does not. Optional exp (unix seconds) is checked by verifyTicket.",
    example: `session.grant(signTicket({ id: member.id, name: member.name }, secret));`,
    status: "shipped",
  },
  {
    id: "verifyTicket",
    name: "verifyTicket",
    module: "socklit/server",
    signature: "verifyTicket<T>(token: string, secret: string): T | null",
    meaning:
      "The identify-side pair of signTicket. Returns null on a bad secret, tamper, or expired exp. OAuth and a users table remain your problem; this binds a token you already trust.",
    example: `return verifyTicket<Member>(token, secret);`,
    status: "shipped",
  },
  {
    id: "listen.origin",
    name: "listen({ origin })",
    module: "socklit/server",
    signature: "listen({ origin: string | string[] })",
    meaning:
      "Allowed Origin (or Host) for the WebSocket upgrade and POST /session. Other origins get 403. Omit locally. One-origin Vite proxy is still the getting-started path.",
    example: `await listen({
  origin: "https://your.site",
  identify,
  createApp: (session) => () => App({ user: session.user }),
});`,
    status: "shipped",
  },
];

for (const entry of CATALOG) {
  if (!SECTION_IDS.has(entry.id)) {
    throw new Error(`catalog entry ${entry.id} is not in API_SECTIONS`);
  }
}
