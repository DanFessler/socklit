import { EventEmitter } from "node:events";
import type { WebSocket } from "ws";

import type {
  ClientMessage,
  PatchOperation,
  ServerMessage,
  WireInstance,
} from "../../../shared/protocol";

/**
 * A socket stand-in, plus the tree walking a browser would do.
 *
 * Shared by `bench.ts` and `test/probes/ledger.test.ts` so the numbers in the
 * write-up and the assertions in the tests are taken from the same code path
 * the real server uses.
 */
export class HarnessSocket extends EventEmitter {
  readonly OPEN = 1;
  readyState = 1;
  readonly sent: ServerMessage[] = [];
  closedWith: { code: number; reason: string } | null = null;

  send(data: string): void {
    this.sent.push(JSON.parse(data) as ServerMessage);
  }

  close(code: number, reason: string): void {
    this.closedWith = { code, reason };
    this.readyState = 3;
    this.emit("close");
  }

  receive(message: ClientMessage): void {
    this.emit("message", JSON.stringify(message), false);
  }

  asWebSocket(): WebSocket {
    return this as unknown as WebSocket;
  }

  take(): ServerMessage[] {
    return this.sent.splice(0, this.sent.length);
  }

  find<T extends ServerMessage["type"]>(
    type: T,
  ): Extract<ServerMessage, { type: T }> | undefined {
    return this.sent.find((message) => message.type === type) as
      | Extract<ServerMessage, { type: T }>
      | undefined;
  }

  last<T extends ServerMessage["type"]>(
    type: T,
  ): Extract<ServerMessage, { type: T }> | undefined {
    for (let index = this.sent.length - 1; index >= 0; index -= 1) {
      const message = this.sent[index];
      if (message?.type === type) {
        return message as Extract<ServerMessage, { type: T }>;
      }
    }
    return undefined;
  }
}

export function findInstance(
  instance: WireInstance,
  predicate: (candidate: WireInstance) => boolean,
): WireInstance | undefined {
  if (predicate(instance)) return instance;

  for (const value of instance.values) {
    if (typeof value !== "object" || value === null) continue;

    if (value.kind === "instance") {
      const found = findInstance(value.instance, predicate);
      if (found) return found;
    } else if (value.kind === "list") {
      for (const item of value.items) {
        const found = findInstance(item.instance, predicate);
        if (found) return found;
      }
    }
  }
  return undefined;
}

export function eventHoles(instance: WireInstance): number[] {
  return instance.values.flatMap((value, hole) =>
    typeof value === "object" && value !== null && value.kind === "event"
      ? [hole]
      : [],
  );
}

/** Locates a line's row instance from its stored id, as the browser would. */
export function rowInstance(
  root: WireInstance,
  lineId: string,
): WireInstance {
  const row = findInstance(root, (candidate) =>
    candidate.id.endsWith(`k:${lineId}`),
  );
  if (!row) throw new Error(`no row instance for line ${lineId}`);
  return row;
}

export function operationBytes(operations: readonly PatchOperation[]): number {
  return JSON.stringify(operations).length;
}

/**
 * Flattens a derived view into leaf paths.
 *
 * Used to state the fan-out of one edit in application terms rather than in
 * protocol terms: each changed path is a place an SPA would have to arrange to
 * be correct, whether by a hand-written optimistic patch or by a refetch.
 */
export function flattenView(value: unknown, prefix = ""): Map<string, unknown> {
  const flat = new Map<string, unknown>();

  const walk = (node: unknown, path: string): void => {
    if (Array.isArray(node)) {
      node.forEach((item, index) => walk(item, `${path}[${index}]`));
      return;
    }
    if (typeof node === "object" && node !== null) {
      for (const [key, child] of Object.entries(node)) {
        walk(child, path === "" ? key : `${path}.${key}`);
      }
      return;
    }
    flat.set(path, node);
  };

  walk(value, prefix);
  return flat;
}

export function changedPaths(before: unknown, after: unknown): string[] {
  const left = flattenView(before);
  const right = flattenView(after);
  const changed: string[] = [];

  for (const [path, value] of right) {
    if (!Object.is(left.get(path), value)) changed.push(path);
  }
  for (const path of left.keys()) {
    if (!right.has(path)) changed.push(path);
  }

  return changed.sort();
}
