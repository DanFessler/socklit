import { useMemo } from "react";

import { highlightSource } from "./highlight";

export function Code(props: {
  source: string;
  language?: string;
  className?: string;
}) {
  const language = props.language ?? "typescript";
  const markup = useMemo(
    () => highlightSource(props.source, language),
    [props.source, language],
  );

  return (
    <pre className={props.className}>
      <code
        className={`hljs language-${language}`}
        dangerouslySetInnerHTML={{ __html: markup }}
      />
    </pre>
  );
}
