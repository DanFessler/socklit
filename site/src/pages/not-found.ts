import { component, html } from "socklit/server";

export const NotFound = component(function NotFound(props: { path: string }) {
  return html`
    <header class="page-head">
      <p class="kicker">404</p>
      <h1>No page at this path.</h1>
      <p class="lede">
        <code>${props.path}</code> is not a route of this site. The replica
        still connected; the template has nothing to show for that address.
      </p>
      <p class="cta-row">
        <a class="cta" href="/">Home</a>
        <a class="cta quiet" href="/guide">Guide</a>
        <a class="cta quiet" href="/api">API</a>
      </p>
    </header>
  `;
});
