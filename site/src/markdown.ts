import { html, keyed, type RenderOutput } from "socklit/server";
import { type Token, type Tokens, marked } from "marked";

import { snippet, type CodeLanguage } from "./code";

function fenceLanguage(lang: string | undefined): CodeLanguage {
  const name = (lang ?? "").split(/\s+/)[0]?.toLowerCase() ?? "";
  if (name === "json") return "json";
  if (name === "bash" || name === "sh" || name === "shell") return "bash";
  if (name === "elixir" || name === "ex" || name === "exs") return "elixir";
  if (name === "html" || name === "xml" || name === "heex") return "xml";
  return "typescript";
}

function asTemplate(node: RenderOutput | string): RenderOutput {
  return typeof node === "string" ? html`${node}` : node;
}

function many(items: Array<RenderOutput | string>): RenderOutput {
  const present = items.filter((item) => item !== "");
  if (present.length === 0) return html``;
  if (present.length === 1) return asTemplate(present[0]!);
  return html`${keyed(present, (_, index) => String(index), (item) => asTemplate(item))}`;
}

function inlines(tokens: Token[] | undefined): RenderOutput {
  return many((tokens ?? []).map(inline));
}

function inline(token: Token): RenderOutput | string {
  switch (token.type) {
    case "text":
      return token.tokens ? inlines(token.tokens) : token.text;
    case "strong":
      return html`<strong>${inlines(token.tokens)}</strong>`;
    case "em":
      return html`<em>${inlines(token.tokens)}</em>`;
    case "del":
      return html`<del>${inlines(token.tokens)}</del>`;
    case "codespan":
      return html`<code>${token.text}</code>`;
    case "link":
      return html`<a href=${token.href}>${inlines(token.tokens)}</a>`;
    case "escape":
      return token.text;
    case "br":
      return html`<br />`;
    default:
      return "text" in token && typeof token.text === "string" ? token.text : "";
  }
}

function heading(token: Token): RenderOutput {
  if (token.type !== "heading") return html``;
  const body = inlines(token.tokens);
  switch (token.depth) {
    case 1:
      return html`<h1>${body}</h1>`;
    case 2:
      return html`<h2>${body}</h2>`;
    case 3:
      return html`<h3>${body}</h3>`;
    default:
      return html`<h4>${body}</h4>`;
  }
}

function list(token: Tokens.List): RenderOutput {
  const items = many(
    token.items.map((item) => html`<li>${many(item.tokens.map(block))}</li>`),
  );
  return token.ordered ? html`<ol>${items}</ol>` : html`<ul>${items}</ul>`;
}

function table(token: Tokens.Table): RenderOutput {
  const head = many(
    token.header.map((cell) => html`<th>${inlines(cell.tokens)}</th>`),
  );
  const rows = many(
    token.rows.map(
      (row) =>
        html`<tr>${many(row.map((cell) => html`<td>${inlines(cell.tokens)}</td>`))}</tr>`,
    ),
  );
  return html`
    <div class="table-wrap">
      <table>
        <thead>
          <tr>${head}</tr>
        </thead>
        <tbody>
          ${rows}
        </tbody>
      </table>
    </div>
  `;
}

function block(token: Token): RenderOutput | string {
  switch (token.type) {
    case "space":
      return "";
    case "heading":
      return heading(token);
    case "paragraph":
      return html`<p>${inlines(token.tokens)}</p>`;
    case "blockquote":
      return html`<blockquote>${many((token.tokens ?? []).map(block))}</blockquote>`;
    case "list":
      return list(token as Tokens.List);
    case "code":
      return snippet(token.text, fenceLanguage(token.lang));
    case "hr":
      return html`<hr />`;
    case "table":
      return table(token as Tokens.Table);
    case "html":
      return html`<p>${token.text}</p>`;
    case "text":
      return html`<p>${inline(token)}</p>`;
    default:
      return "";
  }
}

/** First-party markdown → templates. Code fences become Code islands. */
export function renderMarkdown(source: string): RenderOutput {
  return html`<div class="md">${many(marked.lexer(source).map(block))}</div>`;
}
