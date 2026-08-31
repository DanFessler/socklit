import { component, html } from "socklit/server";

import { snippet } from "../code";

const DELETE = `html\`<button @click=\${() => store.remove(todo.id)}>Delete</button>\``;

const IDENTIFY = `function identify(request: IdentifyRequest): Member | null {
  const token = sessionToken(request);
  if (!token) return null;
  return tickets.get(token) ?? null;
}`;

export const Home = component(function Home() {
  return html`
    <article class="hero">
      <p class="kicker">A server-authoritative UI runtime</p>
      <h1>There is no API for a button.</h1>
      <p class="lede">
        The click is not a POST. It is the function you wrote, running next
        to the row it captured. The browser is a replica: it paints the
        template it is given and sends the address back.
      </p>
      <p class="cta-row">
        <a class="cta" href="/guide">Get started</a>
        <a class="cta quiet" href="/blog">Blog</a>
        <a class="cta quiet" href="/compare">Compare</a>
      </p>
    </article>

    <figure class="specimen">
      <figcaption>A delete is a server closure. No route, no DTO, no hook.</figcaption>
      ${snippet(DELETE)}
    </figure>

    <section class="essay">
      <h2>The click runs next to the data.</h2>
      <p>
        Every serialized API is built around one fact: the object could not
        cross the wire. So you send an id, look the row back up, handle
        not-found, and revalidate a string the server produced ten seconds
        earlier. A Socklit handler never does that. It closed over the row —
        its methods, its dates, its identity. Arguments do not cross a
        boundary. tRPC makes the call type-safe. This deletes the call.
      </p>
    </section>

    <section class="essay">
      <h2>The browser is a replica.</h2>
      <p>
        Static layout crosses the wire once. After that, only the values in
        the bindings move. Events travel as an address into a table of live
        closures, not as an HTTP verb. You do not write a REST handler for a
        button. You do not keep a second copy of the tree in React state.
        The replica paints; the server decides.
      </p>
    </section>

    <section class="essay">
      <h2>Identity is bound to the socket.</h2>
      <p>
        A write that must refuse a stranger reads
        <code>session.user</code> — a value <em>you</em> computed in
        <code>identify</code>, looked up from the token <code>grant</code>
        set as an HttpOnly cookie. The URL query is a filter you chose,
        not a person. Painting a control is not permission.
      </p>
      ${snippet(IDENTIFY)}
    </section>

    <section class="split">
      <div>
        <h2>What you keep</h2>
        <p>
          TypeScript. Function components. Props. The type checker. A store
          you already trust — <code>useStore</code> plus
          <code>subscribe</code>. A JSON file is a default, not the product.
        </p>
      </div>
      <div>
        <h2>What you give up</h2>
        <p>
          npm as the UI. A date picker from the registry does not run here.
          Islands are named client widgets for the cases that cannot wait
          for the wire — typeahead, drag — not a second component model,
          and not React-as-the-app.
        </p>
      </div>
    </section>

    <p class="after">
      Cost is a wash or a win depending on the workload. We do not sell
      cheaper servers. <a href="/performance">The numbers are in research/</a>,
      and the ratios matter more than the dollars.
      <a href="/blog/building-a-todo-app">Let me build you a todo app</a>
      if you want the argument in code.
    </p>
  `;
});
