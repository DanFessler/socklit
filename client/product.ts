import {
  PROTOCOL_VERSION,
  type ClientMessage,
  type ServerMessage,
} from "../shared/protocol";
import { registerIsland } from "./island-catalog";
import "./island-host";
import { ClientRuntime } from "./runtime";
import {
  attachSessionToken,
  attachTabId,
  isCredentialMessage,
  writeSessionToken,
} from "./session-token";
import { checkPeer, expectedAppName, healthUrlFromSocket } from "./peer";

export { registerIsland };

const RECONNECT_MIN_MS = 500;
const RECONNECT_MAX_MS = 5000;

const mount = requireElement("app");
const statusLabel = document.getElementById("status");

mount.addEventListener("socklit:island-error", (event) => {
  const detail = (event as CustomEvent<{ name: string; message: string }>).detail;
  setStatus("error", detail?.message ?? "island error");
});

const query = new URLSearchParams(location.search);
const explicitProtocol = query.get("ws");

function socketUrl(): string {
  const protocol = location.protocol === "https:" ? "wss:" : "ws:";
  const base = explicitProtocol ?? `${protocol}//${location.host}/ws`;
  const url = new URL(base);
  for (const [key, value] of query) {
    if (key !== "ws") url.searchParams.set(key, value);
  }
  if (!url.searchParams.has("path")) {
    url.searchParams.set("path", location.pathname);
  }
  // Cross-origin `?ws=` cannot set our cookie. Fall back to the query token.
  if (explicitProtocol) attachSessionToken(url);
  attachTabId(url);
  return url.toString();
}

let socket: WebSocket | null = null;
let runtime: ClientRuntime | null = null;
let reconnectDelay = RECONNECT_MIN_MS;

void connect();

async function connect(): Promise<void> {
  const href = socketUrl();
  const expected = expectedAppName(mount.dataset["app"]);
  const peer = await checkPeer(healthUrlFromSocket(href), expected);
  if (!peer.ok) {
    setStatus("error", peer.reason);
    if (peer.retry) {
      window.setTimeout(() => {
        void connect();
      }, reconnectDelay);
      reconnectDelay = Math.min(reconnectDelay * 2, RECONNECT_MAX_MS);
    }
    return;
  }

  setStatus("connecting", "connecting");
  const active = new WebSocket(href);
  socket = active;

  runtime = new ClientRuntime({
    mount,
    send: (message) => sendMessage(active, message),
    onError: (message) => {
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
    if (isCredentialMessage(message)) {
      void persistCredential(message.token).finally(() => {
        if (socket === active && active.readyState === WebSocket.OPEN) {
          sendMessage(active, { type: "reidentify", token: message.token });
        }
      });
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
      active.close();
    }
  });

  active.addEventListener("close", () => {
    if (socket === active) {
      socket = null;
      runtime = null;
      setStatus("disconnected", "disconnected");
      window.setTimeout(() => {
        void connect();
      }, reconnectDelay);
      reconnectDelay = Math.min(reconnectDelay * 2, RECONNECT_MAX_MS);
    }
  });

  active.addEventListener("error", () => {
    setStatus("error", "connection error");
  });
}

async function persistCredential(token: string | null): Promise<void> {
  if (!explicitProtocol) {
    try {
      const response = await fetch(new URL("/session", location.origin), {
        method: "POST",
        headers: { "content-type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify({ token }),
      });
      if (response.ok) {
        writeSessionToken(null);
        return;
      }
    } catch {
      // Fall through to the query-string token.
    }
  }
  writeSessionToken(token);
}

function sendMessage(active: WebSocket, message: ClientMessage): void {
  if (active.readyState !== WebSocket.OPEN) return;
  active.send(JSON.stringify(message));
}

function setStatus(state: string, text: string): void {
  if (!statusLabel) return;
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
