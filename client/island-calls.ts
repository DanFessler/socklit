import type { WireJson } from "../shared/protocol";

type Pending = {
  resolve: (result: WireJson | null) => void;
  reject: (error: Error) => void;
};

const pending = new Map<number, Pending>();
let nextCall = 1;

export function nextIslandCall(): number {
  const call = nextCall;
  nextCall += 1;
  return call;
}

export function wait(call: number): Promise<WireJson | null> {
  return new Promise((resolve, reject) => {
    pending.set(call, { resolve, reject });
  });
}

export function finish(
  call: number,
  result: WireJson | null,
  error?: string,
): void {
  const waiter = pending.get(call);
  if (!waiter) return;
  pending.delete(call);
  if (error !== undefined) {
    waiter.reject(new Error(error));
    return;
  }
  waiter.resolve(result);
}
