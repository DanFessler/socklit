import type { WireInstance, WireValue } from "../shared/protocol";

export type TemplateLookup = {
  definition: (id: number) => { strings: string[] };
};

/**
 * Encode a committed wire tree as HTML.
 *
 * Same walk the replica uses to paint, and the same one the checkout
 * harness uses to read a screen. Events and focus are empty: they are
 * addresses, not functions. Islands are empty wells unless they host a
 * slot. Text is escaped.
 */
export function encodeMarkup(
  instance: WireInstance,
  templates: TemplateLookup,
): string {
  const strings = templates.definition(instance.templateId).strings;
  let html = "";
  for (let index = 0; index < strings.length; index += 1) {
    html += strings[index];
    const value = instance.values[index];
    if (value !== undefined) html += encodeValue(value, templates);
  }
  return html;
}

function encodeValue(value: WireValue, templates: TemplateLookup): string {
  if (value === null) return "";
  if (typeof value !== "object") return escapeHtml(String(value));
  // Quoted empty, not `@click=`. That is not an attribute value; Vite's
  // parse5 rejects it and the replica module never runs.
  if (value.kind === "event" || value.kind === "focus") return '""';
  if (value.kind === "instance") return encodeMarkup(value.instance, templates);
  if (value.kind === "list") {
    return value.items
      .map((item) => encodeMarkup(item.instance, templates))
      .join("");
  }
  if (value.kind === "island") {
    return value.slot ? encodeMarkup(value.slot, templates) : "";
  }
  return "";
}

export function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export type PaintMode = "shell" | "html" | "adopt";

export function parsePaint(raw: string | null): PaintMode {
  if (raw === "shell") return "shell";
  if (raw === "html+adopt" || raw === "adopt") return "adopt";
  return "html";
}

const APP_ELEMENT =
  /<([a-zA-Z][\w:-]*)([^>]*\bid=(["'])app\3[^>]*)>([\s\S]*?)<\/\1>/;

/** Read `#app` out of a listen() GET so Vite can keep its own shell. */
export function extractApp(
  document: string,
): { inner: string; revision: number } | null {
  const match = APP_ELEMENT.exec(document);
  if (!match) return null;
  const attrs = match[2] ?? "";
  const inner = match[4] ?? "";
  const revisionMatch = attrs.match(/\bdata-revision=(["'])([^"']*)\1/);
  const revision = revisionMatch ? Number(revisionMatch[2]) : 1;
  return {
    inner,
    revision: Number.isFinite(revision) && revision > 0 ? revision : 1,
  };
}

/**
 * Put the encoded tree inside `#app`. Adds `data-revision` and `data-paint`.
 * Leaves the document unchanged when there is no `#app`.
 */
export function injectApp(
  document: string,
  inner: string,
  revision: number,
  paint: PaintMode,
  appName?: string,
): string {
  if (!APP_ELEMENT.test(document)) return document;
  return document.replace(
    APP_ELEMENT,
    (_match, tag: string, attrs: string) => {
      const cleaned = attrs
        .replace(/\sdata-revision=(["'])[^"']*\1/, "")
        .replace(/\sdata-paint=(["'])[^"']*\1/, "")
        .replace(/\sdata-app=(["'])[^"']*\1/, "");
      const app = appName ? ` data-app="${escapeHtml(appName)}"` : "";
      return `<${tag}${cleaned} data-revision="${revision}" data-paint="${paint === "adopt" ? "html+adopt" : paint}"${app}>${inner}</${tag}>`;
    },
  );
}

export const DEFAULT_SHELL = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8"/>
<meta name="viewport" content="width=device-width, initial-scale=1"/>
<title>Socklit</title>
</head>
<body>
<main id="app"></main>
</body>
</html>
`;
