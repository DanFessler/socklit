import { component, html, keyed, type RenderOutput } from "socklit/server";

export const ROUTES = [
  { href: "/guide", label: "Guide" },
  { href: "/blog", label: "Blog" },
  { href: "/api", label: "API" },
  { href: "/compare", label: "Compare" },
  { href: "/performance", label: "Performance" },
] as const;

export function normalizePath(path: string): string {
  if (path.length > 1 && path.endsWith("/")) return path.slice(0, -1);
  return path || "/";
}

function isCurrent(href: string, path: string): boolean {
  if (path === href) return true;
  return href !== "/" && path.startsWith(`${href}/`);
}

const NavLinks = component(function NavLinks(props: { path: string; id: string }) {
  return html`<div class="nav-links" id=${props.id}>
    ${keyed(
      ROUTES,
      (route) => route.href,
      (route) =>
        isCurrent(route.href, props.path)
          ? html`<a href=${route.href} class="is-current" aria-current="page">${route.label}</a>`
          : html`<a href=${route.href}>${route.label}</a>`,
    )}
  </div>`;
});

export const Shell = component(function Shell(props: {
  path: string;
  children: RenderOutput;
}) {
  return html`
    <a class="skip" href="#content">Skip to content</a>
    <header class="mast">
      <a class="wordmark" href="/">Socklit</a>
      <nav class="nav-wide" aria-label="Documentation">
        ${NavLinks({ path: props.path, id: "nav-wide" })}
      </nav>
      <details class="nav-collapse">
        <summary>Menu</summary>
        ${NavLinks({ path: props.path, id: "nav-narrow" })}
      </details>
    </header>
    <div id="content" class="page">${props.children}</div>
    <footer class="colophon">
      <p>
        This site is a Socklit app. Templates run on the server. Code
        blocks and the API filter are islands.
      </p>
      <p class="colophon-links">
        <a href="/">Home</a>
        ${keyed(
          ROUTES,
          (route) => route.href,
          (route) => html`<a href=${route.href}>${route.label}</a>`,
        )}
      </p>
    </footer>
  `;
});
