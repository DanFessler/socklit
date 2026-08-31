import { component, html } from "socklit/server";

export const Compare = component(function Compare() {
  return html`
    <header class="page-head">
      <p class="kicker">Prior art</p>
      <h1>Honest comparison.</h1>
      <p class="lede">
        Nothing here is new. The server-authoritative UI has been built in
        three decades. Socklit’s difference is TypeScript, server-authoritative
        templates, islands as named holes, identity bound to the socket, and
        a store you bring. We do not have Elixir’s ecosystem. We do not have
        React’s npm-as-the-app.
      </p>
    </header>

    <div class="table-wrap">
      <table class="compare">
        <thead>
          <tr>
            <th></th>
            <th>Who renders</th>
            <th>Live session</th>
            <th>Language you keep</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <th>REST + SPA</th>
            <td>Browser, from JSON</td>
            <td>No</td>
            <td>TypeScript, and npm</td>
          </tr>
          <tr>
            <th>Next / RSC</th>
            <td>Server, then hydrate</td>
            <td>No — request/response</td>
            <td>TypeScript, Next’s boundary rules</td>
          </tr>
          <tr>
            <th>LiveView</th>
            <td>Server, hole patches</td>
            <td>Yes — a BEAM process</td>
            <td>Elixir</td>
          </tr>
          <tr>
            <th>htmx</th>
            <td>Server, HTML fragments</td>
            <td>No</td>
            <td>Whatever rendered the HTML</td>
          </tr>
          <tr>
            <th>Meteor</th>
            <td>Browser, from a mini-mongo</td>
            <td>Yes — data, not UI</td>
            <td>JavaScript, Meteor’s stack</td>
          </tr>
          <tr>
            <th>Socklit</th>
            <td>Server, interned templates</td>
            <td>Yes — a JS object</td>
            <td>TypeScript; npm stops at the island</td>
          </tr>
        </tbody>
      </table>
    </div>

    <section class="essay">
      <h2>REST + SPA</h2>
      <p>
        You write the endpoint, the DTO, the client cache, the pending
        state, and the invalidate. The same fact lives in four places
        (database, server cache, client cache, component state). A
        well-built real-time SPA adds a fifth. Socklit keeps one. That is
        the human-complexity argument, not a speed argument. The SPA still
        wins at continuous pointer interaction, and it keeps the component
        catalog. We do not pretend a Socklit tree can import Recharts.
      </p>
      <p class="after">
        <a href="/blog/socklit-vs-spa">Socklit vs REST + SPA, a Deep Dive</a>
      </p>
    </section>

    <section class="essay">
      <h2>Next / React Server Components</h2>
      <p>
        RSC solved serializing a tree that is partly server-rendered and
        partly client-hydrated. It is request/response with no live
        session, so it is not this architecture. The boundary is a file
        suffix and a mental model the market has already punished for
        confusion. Socklit’s tell is the opposite of RSC’s: a server
        component is called as a function (or a tag you claimed); an
        island is a <code>&lt;mount&gt;</code>. They are not the same JSX.
        Next has distribution. We do not.
      </p>
      <p class="after">
        <a href="/blog/socklit-vs-rsc">Socklit vs Next / RSC, a Deep Dive</a>
      </p>
    </section>

    <section class="essay">
      <h2>Phoenix LiveView</h2>
      <p>
        The closest relative on the wire: statics sent once, dynamics as a
        map, a retained tree per connection. LiveView sends a
        <em>name</em> — <code>phx-click="delete"</code> — which the server
        pattern-matches. Socklit sends an <em>address</em> into a table of
        live closures, which is why
        <code>store.remove(todo.id)</code> can be written inline. A name
        is stable across reconnect; an address is not. That is why this
        runtime needs stale-event recovery and LiveView does not. The
        ergonomic win and the recovery burden are the same decision.
      </p>
      <p>
        The substrate is not incidental. The BEAM gives cheap isolated
        processes and preemptive scheduling. Node gives this runtime none
        of that: sessions share one heap and one event loop. Fan-out is a
        Node problem in a way it is not a BEAM problem, and it is not
        fixable here. LiveView succeeded completely inside Elixir and
        barely traveled. That is the gap this project is actually in —
        Solara’s programming model on LiveView’s wire, in TypeScript —
        not a claim that we out-engineered Phoenix.
      </p>
      <p class="after">
        <a href="/blog/socklit-vs-liveview">Socklit vs LiveView, a Deep Dive</a>
      </p>
    </section>

    <section class="essay">
      <h2>htmx</h2>
      <p>
        The most serious competitor, and not because it is similar.
        htmx is <strong>stateless</strong>. No retained tree, no replica,
        no sticky sessions, no reconnect storm, no session to migrate. For
        most internal tools, htmx is the better answer: it deletes the
        same API ceremony with a fraction of the machinery. HTTP caching
        amortizes an impersonal fragment for free; we have not beaten a
        CDN on cost.
      </p>
      <p>
        What remains is a short list. Multiplayer push is native here and
        hand-managed there. One changed number is a scalar, not a swapped
        fragment. Local DOM state survives a hole patch by construction.
        The authoring is typed function components, not hypermedia
        attributes. If you wanted HTML over the wire and do not need a
        live tree, use htmx. This is for when the screen is a shared,
        pushed view and the handler should close over the row.
      </p>
      <p class="after">
        <a href="/blog/socklit-vs-htmx">Socklit vs htmx, a Deep Dive</a>
      </p>
    </section>

    <section class="essay">
      <h2>Meteor</h2>
      <p>
        The road not taken. Meteor attacked the same ceremony by
        replicating the <em>database</em> to the client rather than
        keeping the <em>UI</em> on the server. The volume of data on the
        client, and authorization pushed into publication rules, are
        problems this architecture avoids by construction: the client
        physically never receives what the server did not render. Meteor
        sold a demo and a worldview; the company survived by extracting
        Apollo and abandoning the architecture. We are not selling magic.
      </p>
      <p class="after">
        <a href="/blog/socklit-vs-meteor">Socklit vs Meteor, a Deep Dive</a>
      </p>
    </section>

    <section class="essay">
      <h2>The difference, said once</h2>
      <ul>
        <li><strong>TypeScript</strong> — the language the audience already uses. Not Elixir, not C#.</li>
        <li><strong>Server-authoritative templates</strong> — interned layout, hole patches, not HTML morph and not a client VDOM.</li>
        <li><strong>Islands as named holes</strong> — not a second component type, not <code>"use client"</code>.</li>
        <li><strong>Identity bound to the socket</strong> — <code>identify</code> / <code>grant</code>, not a JWT you re-parse on every POST.</li>
        <li><strong>Store-agnostic</strong> — <code>useStore</code> + <code>subscribe</code>. The JSON file is a default.</li>
      </ul>
      <p>
        Cross-session subtree sharing is the one claim no predecessor has
        attempted. It is measured and unbuilt. Without it, this is a
        nicer-typed LiveView for TypeScript, which is a respectable thing
        to be, and should be labeled that way.
      </p>
    </section>
  `;
});
