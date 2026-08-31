import hljs from "highlight.js/lib/core";
import bash from "highlight.js/lib/languages/bash";
import elixir from "highlight.js/lib/languages/elixir";
import json from "highlight.js/lib/languages/json";
import typescript from "highlight.js/lib/languages/typescript";
import xml from "highlight.js/lib/languages/xml";

hljs.registerLanguage("bash", bash);
hljs.registerLanguage("elixir", elixir);
hljs.registerLanguage("json", json);
hljs.registerLanguage("typescript", typescript);
hljs.registerLanguage("xml", xml);

const LANGUAGES = new Set(["bash", "elixir", "json", "typescript", "xml"]);

/** Escape + color a snippet. highlight.js escapes the source. */
export function highlightSource(source: string, language: string): string {
  const name = LANGUAGES.has(language) ? language : "typescript";
  return hljs.highlight(source, { language: name, ignoreIllegals: true }).value;
}
