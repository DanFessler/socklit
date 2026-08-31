import { defineIsland, html } from "socklit/server";

export type CodeLanguage = "typescript" | "json" | "bash" | "elixir" | "xml";

/** Highlighted snippet. The server sends source; the replica colors it. */
export const Code = defineIsland<{
  source: string;
  language: CodeLanguage;
}>("Code");

export function snippet(
  source: string,
  language: CodeLanguage = "typescript",
) {
  return html`<mount
    .Island=${Code}
    .source=${source}
    .language=${language}
  ></mount>`;
}
