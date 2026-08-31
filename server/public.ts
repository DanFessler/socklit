/**
 * The author-facing server API.
 *
 * Import this as `socklit/server`. Nothing else in this package is a
 * supported surface for a first application.
 */

export { html } from "lit-html";

export {
  component,
  createContext,
  useContext,
  useRef,
  useState,
  useStore,
  type ComponentFactory,
  type ComponentOptions,
  type RenderOutput,
} from "./component";

export { keyed } from "./keyed";

export {
  createJsonStore,
  JsonStore,
  StoreError,
  type JsonStoreOptions,
} from "./json-store";

export { changeSource, ChangeSource } from "./source";
export { signTicket, verifyTicket } from "./ticket";
export { PROTOCOL_VERSION } from "./protocol-version";

export { listen, type IdentifyRequest, type ListenHandle, type ListenOptions } from "./listen";

export { parseCookies } from "./cookies";
export { sessionToken } from "./session-cookie";
export { SESSION_COOKIE, SESSION_QUERY } from "../shared/protocol";

export type { SessionHandle } from "./session";
export type { ChangeListener, SessionContext } from "./probes/types";

export type {
  ChangePayload,
  SubmitPayload,
  ClickPayload,
  KeyPayload,
  FocusPayload,
  EventPayload,
} from "../shared/protocol";

export { defineIsland, mount, slot } from "./island";
export type { IslandEvents, IslandServerEvents } from "./island";
