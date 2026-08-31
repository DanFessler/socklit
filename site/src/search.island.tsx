import { useEffect, useMemo, useState } from "react";

import { groupCatalog, type CatalogEntry } from "./catalog";
import { Code } from "./code.island";

export function ApiSearch(props: { entries: CatalogEntry[] }) {
  const [query, setQuery] = useState("");
  const [active, setActive] = useState<string | null>(null);

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return props.entries;
    return props.entries.filter((entry) => {
      const hay = `${entry.name} ${entry.module} ${entry.signature} ${entry.meaning} ${entry.example ?? ""} ${entry.status}`;
      return hay.toLowerCase().includes(q);
    });
  }, [props.entries, query]);

  const sections = useMemo(() => groupCatalog(shown), [shown]);
  const count =
    shown.length === props.entries.length
      ? `${shown.length} exports`
      : `${shown.length} of ${props.entries.length}`;

  useEffect(() => {
    const hash = location.hash.slice(1);
    if (!hash) return;
    document.getElementById(hash)?.scrollIntoView({ block: "start" });
  }, [sections]);

  useEffect(() => {
    const nodes = sections
      .map((section) => document.getElementById(`api-${section.id}`))
      .filter((node): node is HTMLElement => node !== null);
    if (nodes.length === 0) return;

    const observer = new IntersectionObserver(
      (records) => {
        const visible = records
          .filter((record) => record.isIntersecting)
          .sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top);
        const id = visible[0]?.target.id.replace(/^api-/, "");
        if (id) setActive(id);
      },
      { rootMargin: "-15% 0px -70% 0px", threshold: 0 },
    );
    for (const node of nodes) observer.observe(node);
    return () => observer.disconnect();
  }, [sections]);

  return (
    <div className="api-docs">
      <div className="api-layout">
        <nav className="api-sidenav" aria-label="API sections">
          <label className="api-search-field">
            <span className="api-search-label">Filter</span>
            <input
              type="search"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="html, grant…"
              autoComplete="off"
              spellCheck={false}
              aria-controls="api-catalog"
            />
          </label>
          <p className="api-search-count" aria-live="polite">
            {count}
          </p>
          {sections.length > 0 ? (
            <>
              <p className="api-sidenav-kicker">On this page</p>
              <ol>
                {sections.map((section) => (
                  <li key={section.id}>
                    <a
                      href={`#api-${section.id}`}
                      className={active === section.id ? "is-current" : undefined}
                    >
                      {section.title}
                    </a>
                    <ol>
                      {section.entries.map((entry) => (
                        <li key={entry.id}>
                          <a href={`#${entry.id}`}>
                            <code>{entry.name}</code>
                          </a>
                        </li>
                      ))}
                    </ol>
                  </li>
                ))}
              </ol>
            </>
          ) : null}
        </nav>

        {shown.length === 0 ? (
          <p className="api-empty">No export matches that filter.</p>
        ) : (
          <div id="api-catalog" className="api-body">
            {sections.map((section) => (
              <section
                key={section.id}
                id={`api-${section.id}`}
                className="api-section"
                aria-labelledby={`api-${section.id}-title`}
              >
                <h2 id={`api-${section.id}-title`}>{section.title}</h2>
                <p className="api-section-intro">{section.intro}</p>
                <ol className="api-list">
                  {section.entries.map((entry) => (
                    <li key={entry.id} id={entry.id} className="api-entry">
                      <header>
                        <h3>
                          <code>{entry.name}</code>
                        </h3>
                        <p className="api-meta">
                          <span className="api-module">{entry.module}</span>
                          {entry.status === "planned" ? (
                            <span className="api-planned">planned</span>
                          ) : null}
                        </p>
                      </header>
                      <Code className="api-sig" source={entry.signature} />
                      <p className="api-meaning">{entry.meaning}</p>
                      {entry.example ? (
                        <figure className="api-example">
                          <figcaption>Example</figcaption>
                          <Code source={entry.example} />
                        </figure>
                      ) : null}
                    </li>
                  ))}
                </ol>
              </section>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
