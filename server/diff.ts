import {
  wireValueKind,
  type PatchOperation,
  type WireFocusValue,
  type WireInstance,
  type WireIslandValue,
  type WireListValue,
  type WireValue,
} from "../shared/protocol";

/**
 * Reduces two consecutive instance trees to the smallest set of operations the
 * replica needs.
 *
 * Structure is addressed rather than walked: because instance ids are derived
 * from hole positions and list keys, the same address in both trees describes
 * the same place in the UI.
 *
 * - a changed primitive becomes one `set` for that hole
 * - a changed nested template becomes one `set` carrying the new subtree
 * - a changed key sequence becomes one `list` for that hole
 * - a changed root template becomes `replace`, the only op without a parent hole
 */
export function diff(
  previous: WireInstance,
  next: WireInstance,
): PatchOperation[] {
  const operations: PatchOperation[] = [];

  if (!sameShape(previous, next)) {
    operations.push({ op: "replace", instanceId: next.id, instance: next });
    return operations;
  }

  diffValues(previous, next, operations);
  return operations;
}

function diffValues(
  previous: WireInstance,
  next: WireInstance,
  operations: PatchOperation[],
): void {
  for (let hole = 0; hole < next.values.length; hole += 1) {
    diffValue(
      next.id,
      hole,
      previous.values[hole] ?? null,
      next.values[hole] ?? null,
      operations,
    );
  }
}

function diffValue(
  instanceId: string,
  hole: number,
  previous: WireValue,
  next: WireValue,
  operations: PatchOperation[],
): void {
  const previousKind = wireValueKind(previous);
  const nextKind = wireValueKind(next);

  if (previousKind !== nextKind) {
    operations.push({ op: "set", instanceId, hole, value: next });
    return;
  }

  switch (nextKind) {
    case "primitive": {
      if (!Object.is(previous, next)) {
        operations.push({ op: "set", instanceId, hole, value: next });
      }
      return;
    }

    // The closure changed identity on the server, but the browser side of an
    // event hole is a dispatcher addressed by instance and hole, so there is
    // nothing to replicate.
    case "event":
      return;

    // Sent whenever it differs, which is the entire mechanism: the client acts
    // on receiving the change, so suppressing an unchanged one is not an
    // optimization but the thing that stops focus being stolen every frame.
    case "focus": {
      const before = previous as WireFocusValue;
      const after = next as WireFocusValue;

      if (before.active !== after.active || before.nonce !== after.nonce) {
        operations.push({ op: "set", instanceId, hole, value: next });
      }
      return;
    }

    case "instance": {
      const previousInstance = (previous as { instance: WireInstance }).instance;
      const nextInstance = (next as { instance: WireInstance }).instance;

      if (!sameShape(previousInstance, nextInstance)) {
        operations.push({ op: "set", instanceId, hole, value: next });
        return;
      }

      diffValues(previousInstance, nextInstance, operations);
      return;
    }

    case "island": {
      const before = previous as WireIslandValue;
      const after = next as WireIslandValue;

      if (
        before.name !== after.name ||
        !sameEvents(before.events, after.events) ||
        JSON.stringify(before.props) !== JSON.stringify(after.props)
      ) {
        operations.push({ op: "set", instanceId, hole, value: next });
      }
      return;
    }

    case "list": {
      const previousList = previous as WireListValue;
      const nextList = next as WireListValue;

      if (!sameKeys(previousList, nextList)) {
        operations.push({ op: "list", instanceId, hole, value: nextList });
        return;
      }

      const nested: PatchOperation[] = [];
      for (let index = 0; index < nextList.items.length; index += 1) {
        const previousItem = previousList.items[index];
        const nextItem = nextList.items[index];
        if (!previousItem || !nextItem) continue;

        if (!sameShape(previousItem.instance, nextItem.instance)) {
          // A row kept its key but switched template; replace the whole hole
          // rather than inventing a per-row replace operation.
          operations.push({ op: "list", instanceId, hole, value: nextList });
          return;
        }

        diffValues(previousItem.instance, nextItem.instance, nested);
      }

      operations.push(...nested);
      return;
    }

    // A kind added to the protocol and not handled here would otherwise fall
    // out of the switch and be silently treated as never changing, which is the
    // worst failure this file can have: the screen just stops updating.
    default:
      throw new Error(`diff has no rule for wire value kind ${nextKind}`);
  }
}

function sameShape(previous: WireInstance, next: WireInstance): boolean {
  return (
    previous.id === next.id &&
    previous.templateId === next.templateId &&
    previous.values.length === next.values.length
  );
}

function sameEvents(previous: string[], next: string[]): boolean {
  if (previous.length !== next.length) return false;
  return previous.every((name, index) => name === next[index]);
}

function sameKeys(previous: WireListValue, next: WireListValue): boolean {
  if (previous.items.length !== next.items.length) return false;
  return previous.items.every((item, index) => item.key === next.items[index]?.key);
}
