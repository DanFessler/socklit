import { randomUUID } from "node:crypto";

import { TAB_QUERY } from "../shared/protocol";
import { HookHost } from "./component";
import { durableIdentity, type DurableVault } from "./durable";
import { encodeMarkup } from "./markup";
import type { ProbeInstance, SessionContext } from "./probes/types";
import { serialize, TemplateRegistry } from "./serialize";

export type FirstPaint = {
  markup: string;
  revision: number;
};

/**
 * One render of the app for an HTTP GET.
 *
 * Same `createApp` as connect. The host is discarded after the response.
 * Identity is whoever `identify` computed from the request. There is no
 * socket and usually no tab.
 */
export function renderFirstPaint(options: {
  createApp: (session: SessionContext) => ProbeInstance;
  params: URLSearchParams;
  user: unknown | null;
  durable: DurableVault;
}): FirstPaint {
  const context: SessionContext = {
    id: `paint-${randomUUID().slice(0, 8)}`,
    params: options.params,
    user: options.user,
    grant: () => {},
    revoke: () => {},
    invalidate: () => {},
  };

  const instance = options.createApp(context);
  const host = HookHost.firstPaint({
    vault: options.durable,
    identity: () => durableIdentity(options.user, options.params),
    tab: () => options.params.get(TAB_QUERY),
  });
  const registry = new TemplateRegistry();

  try {
    const painted = serialize(instance.app(), registry, host);
    return { markup: encodeMarkup(painted.root, registry), revision: 1 };
  } finally {
    host.disposeAll();
    instance.dispose?.();
  }
}
