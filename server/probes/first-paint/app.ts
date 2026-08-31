import { html } from "lit-html";

import { component, useDurable, useState, useStore } from "../../component";
import type { BriefStore } from "./store";

export type Member = { name: string };

export const BriefApp = component(function BriefApp(props: {
  store: BriefStore;
  user: Member | null;
}) {
  const store = useStore(props.store);
  const { brief, readers, stars } = store.state();
  const who = props.user?.name ?? null;
  const [flash] = useState("");
  const [tabNote] = useDurable("tab-note", "initial tab");
  const [userNote] = useDurable("user-note", "initial user", { share: "user" });
  const starred = who ? Boolean(stars[who]) : false;

  return html`
    <article>
      <header>
        <p data-probe="chip">${who ?? "Sign in"}</p>
        <p data-probe="readers">${readers} readers</p>
      </header>
      <h1 data-probe="title">${brief.title}</h1>
      <p data-probe="byline">${brief.byline}</p>
      <p data-probe="body">${brief.body}</p>
      <p data-probe="tab-note">${tabNote}</p>
      <p data-probe="user-note">${userNote}</p>
      ${flash
        ? html`<p data-probe="flash">${flash}</p>`
        : null}
      <button
        type="button"
        data-probe="star"
        @click=${() => {
          if (!who) return;
          store.star(who);
        }}
      >
        ${starred ? "Starred" : "Star"}
      </button>
    </article>
  `;
});
