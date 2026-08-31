import { component, html } from "socklit/server";

import { CATALOG } from "../catalog";
import { ApiSearch } from "../search";

export const Api = component(function Api() {
  return html`
    <header class="page-head">
      <p class="kicker">socklit/server · socklit/client · socklit/vite</p>
      <h1>API</h1>
      <p class="lede">
        Every public export from socklit/server, socklit/client, and
        socklit/vite, grouped the way you write an app. Filter as you type.
      </p>
    </header>
    <mount .Island=${ApiSearch} .entries=${CATALOG}></mount>
  `;
});
