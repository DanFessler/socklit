import {
  PROTOCOL_VERSION,
  type ClientMessage,
  type ServerMessage,
} from "../shared/protocol";
import {
  LATENCY_PRESETS,
  oneWayDelay,
  OrderedDelay,
  readLatencyProfile,
  writeLatencyProfile,
  type LatencyProfile,
} from "./latency";
import { islandComponents } from "../islands/registry";
import { registerIsland } from "./island-catalog";
import { ClientRuntime } from "./runtime";
import "./island-host";
import { ProtocolLog } from "./protocol-log";
import { checkPeer, expectedAppName, healthUrlFromSocket } from "./peer";
import {
  attachSessionToken,
  attachTabId,
  isCredentialMessage,
  writeSessionToken,
} from "./session-token";

for (const [name, component] of Object.entries(islandComponents)) {
  registerIsland(name, component);
}

const RECONNECT_MIN_MS = 500;
const RECONNECT_MAX_MS = 5000;

const mount = requireElement("app");
const statusLabel = requireElement("status");

mount.addEventListener("socklit:island-error", (event) => {
  const detail = (event as CustomEvent<{ name: string; message: string }>).detail;
  setStatus("error", detail?.message ?? "island error");
});
const revisionLabel = requireElement("revision");
const perceivedLabel = requireElement("perceived");
const latencySelect = requireElement("latency") as HTMLSelectElement;
const jitterToggle = requireElement("jitter") as HTMLInputElement;
const log = new ProtocolLog(
  requireElement("protocol-entries"),
  requireElement("protocol-summary"),
);

const query = new URLSearchParams(location.search);
const probeId = query.get("probe") ?? "todo";

// Every query parameter is forwarded, so a probe can be configured per tab
// (?probe=routes&user=alice) without the client knowing what any of it means.
function socketUrl(): string {
  // Same origin as the page. Vite proxies /ws to this lab's listen(),
  // not to whichever product app bound 8787.
  const protocol = location.protocol === "https:" ? "wss:" : "ws:";
  const base = query.get("ws") ?? `${protocol}//${location.host}/ws`;
  const url = new URL(base);
  for (const [key, value] of query) {
    if (key !== "ws" && key !== "latency" && key !== "jitter") {
      url.searchParams.set(key, value);
    }
  }
  url.searchParams.set("probe", probeId);
  attachSessionToken(url);
  attachTabId(url);
  return url.toString();
}

let latency: LatencyProfile = readLatencyProfile(location.search);
let socket: WebSocket | null = null;
let runtime: ClientRuntime | null = null;
let reconnectDelay = RECONNECT_MIN_MS;

/**
 * The moment the user acted, held until the resulting update is applied. This
 * measures what the user actually waits for, including both simulated hops.
 */
let actionStartedAt: number | null = null;

type InboundFrame = { message: ServerMessage; bytes: number };
type OutboundFrame = { socket: WebSocket; encoded: string };

// The simulated link sits between the socket and everything else, so both the
// replica and the protocol panel observe messages when the client acts on them.
const inbound = new OrderedDelay<InboundFrame>(deliverInbound);
const outbound = new OrderedDelay<OutboundFrame>(deliverOutbound);

initLatencyControls();
void initProbePicker();
renderPerceived(null);
void connect();

/** Populated from the protocol server, so adding a probe needs no client change. */
async function initProbePicker(): Promise<void> {
  const picker = document.getElementById("probe");
  if (!(picker instanceof HTMLSelectElement)) return;

  try {
    const origin = new URL(socketUrl());
    const response = await fetch(
      `http${origin.protocol === "wss:" ? "s" : ""}://${origin.host}/probes`,
    );
    const available = (await response.json()) as Array<{
      id: string;
      title: string;
    }>;

    for (const probe of available) {
      const option = document.createElement("option");
      option.value = probe.id;
      option.textContent = probe.title;
      picker.append(option);
    }

    picker.value = probeId;
    picker.addEventListener("change", () => {
      const next = new URLSearchParams(location.search);
      next.set("probe", picker.value);
      location.search = next.toString();
    });
  } catch {
    picker.disabled = true;
  }
}

async function connect(): Promise<void> {
  const href = socketUrl();
  const expected = expectedAppName(mount.dataset["app"]);
  const peer = await checkPeer(healthUrlFromSocket(href), expected);
  if (!peer.ok) {
    setStatus("error", peer.reason);
    if (peer.retry) scheduleReconnect();
    return;
  }

  setStatus("connecting", "connecting");
  const active = new WebSocket(href);
  socket = active;

  // A fresh replica per connection: template ids are process-local to the
  // server, so a reconnect must not reuse a cache from a previous process.
  runtime = new ClientRuntime({
    mount,
    send: (message) => sendMessage(active, message),
    onError: (message) => {
      // Already recorded by deliverInbound; only surface it in the status line.
      setStatus(
        message.recoverable ? "connected" : "error",
        `${message.code}: ${message.message}`,
      );
    },
  });

  active.addEventListener("open", () => {
    reconnectDelay = RECONNECT_MIN_MS;
    setStatus("connected", "connected");
  });

  active.addEventListener("message", (event) => {
    if (typeof event.data !== "string") return;

    let message: ServerMessage;
    try {
      message = JSON.parse(event.data) as ServerMessage;
    } catch {
      console.error("unparseable server message", event.data);
      return;
    }

    inbound.push(
      { message, bytes: event.data.length },
      oneWayDelay(latency),
    );
  });

  active.addEventListener("close", () => {
    if (socket === active) {
      socket = null;
      runtime = null;
      // Anything still in flight belongs to a connection that no longer exists.
      inbound.clear();
      outbound.clear();
      actionStartedAt = null;
      setStatus("disconnected", "disconnected");
      scheduleReconnect();
    }
  });

  active.addEventListener("error", () => {
    setStatus("error", "connection error");
  });
}

function deliverInbound({ message, bytes }: InboundFrame): void {
  log.record("in", message, bytes);

  if (isCredentialMessage(message)) {
    writeSessionToken(message.token);
    if (socket && socket.readyState === WebSocket.OPEN) {
      sendMessage(socket, { type: "reidentify", token: message.token });
    }
    return;
  }

  if (
    message.type === "snapshot" &&
    message.protocol !== undefined &&
    message.protocol !== PROTOCOL_VERSION
  ) {
    setStatus("error", `unsupported protocol ${message.protocol}`);
    return;
  }

  try {
    runtime?.apply(message);
  } catch (error) {
    console.error("failed to apply server message", error, message);
    setStatus("error", "replica out of sync, reconnecting");
    socket?.close();
    return;
  }

  revisionLabel.textContent = String(runtime?.revision ?? 0);

  if (
    actionStartedAt !== null &&
    (message.type === "update" || message.type === "snapshot")
  ) {
    renderPerceived(performance.now() - actionStartedAt);
    actionStartedAt = null;
  }
}

function deliverOutbound({ socket: target, encoded }: OutboundFrame): void {
  // The socket may have closed while this frame was in flight.
  if (target.readyState !== WebSocket.OPEN) return;
  target.send(encoded);
}

function sendMessage(active: WebSocket, message: ClientMessage): void {
  if (active.readyState !== WebSocket.OPEN) return;

  const encoded = JSON.stringify(message);

  // Recorded at dispatch: this is the instant the user interacted, which is
  // where the perceived wait begins.
  log.record("out", message, encoded.length);
  actionStartedAt = performance.now();
  renderPerceived(null);

  outbound.push({ socket: active, encoded }, oneWayDelay(latency));
}

function initLatencyControls(): void {
  const options = LATENCY_PRESETS.map((preset) => preset);
  if (!options.some((preset) => preset.rttMs === latency.rttMs)) {
    options.push({ rttMs: latency.rttMs, label: `${latency.rttMs} ms` });
    options.sort((left, right) => left.rttMs - right.rttMs);
  }

  for (const preset of options) {
    const option = document.createElement("option");
    option.value = String(preset.rttMs);
    option.textContent = preset.label;
    latencySelect.append(option);
  }

  latencySelect.value = String(latency.rttMs);
  jitterToggle.checked = latency.jitter;

  latencySelect.addEventListener("change", () => {
    latency = { ...latency, rttMs: Number(latencySelect.value) };
    writeLatencyProfile(latency);
    renderPerceived(null);
  });

  jitterToggle.addEventListener("change", () => {
    latency = { ...latency, jitter: jitterToggle.checked };
    writeLatencyProfile(latency);
  });
}

function renderPerceived(observedMs: number | null): void {
  const simulated =
    latency.rttMs === 0
      ? "no simulated latency"
      : `simulating ${latency.rttMs} ms round trip`;

  perceivedLabel.textContent =
    observedMs === null
      ? simulated
      : `${simulated} \u00b7 last action felt ${Math.round(observedMs)} ms`;
}

function scheduleReconnect(): void {
  const delay = reconnectDelay;
  reconnectDelay = Math.min(reconnectDelay * 2, RECONNECT_MAX_MS);
  window.setTimeout(() => {
    void connect();
  }, delay);
}

function setStatus(state: string, text: string): void {
  statusLabel.dataset["state"] = state;
  statusLabel.textContent = text;
}

function requireElement(id: string): HTMLElement {
  const element = document.getElementById(id);
  if (!element) {
    throw new Error(`missing #${id} in the bootstrap document`);
  }
  return element;
}
