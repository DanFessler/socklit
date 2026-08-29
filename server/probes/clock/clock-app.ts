import { html } from "lit-html";

import type { ChangePayload } from "../../../shared/protocol";
import {
  component,
  useState,
  useStore,
  type RenderOutput,
  type StateSetter,
} from "../../component";
import { keyed } from "../../keyed";
import { formatClock, type ClockStore } from "./clock-store";
import type { StaticRow } from "./dataset";

/**
 * A dashboard whose only moving part is one string.
 *
 * The tree is arranged so that a tick can change exactly one hole: the clock's
 * time is the sole value derived from shared state, and everything else is
 * either constant for the life of the session or changes only when the user
 * acts. Any operation beyond that one `set` is therefore work the runtime did
 * because it had no way to know it was unnecessary.
 */

export type ClockAppOptions = {
  store: ClockStore;
  rows: StaticRow[];
  /** Per-session, so a session can stop depending on the clock entirely. */
  showClock: boolean;
  /** Off by default: counting renders is itself a change, see the write-up. */
  countRenders: boolean;
};

export const ClockApp = component(function ClockApp(props: {
  store: ClockStore;
  rows: StaticRow[];
  /** Read once. After that the session owns its own answer. */
  initialShowClock: boolean;
  countRenders: boolean;
}) {
  const { rows } = props;
  const store = useStore(props.store);

  // Lives here rather than in <Controls> because the clock face reads it and
  // the controls write it, so it has to sit above both. The setter is absolute
  // intent rather than a toggle, per authoring rule I6, and it ignores a write
  // that changes nothing, so two clients asking for "hidden" cannot cancel out.
  const [showClock, setShowClock] = useState(props.initialShowClock);

  // A box, not a value: the count changes *because* a render happened, and a
  // setter called during a render is refused. See the write-up.
  const [counter] = useState(() => ({ renders: 0 }));

  // The only side effect in the render path. It makes this session's renders
  // observable, at the cost of making every one of them produce wire traffic.
  counter.renders += 1;
  const state = store.state();

  return html`
      <header class="app-header">
        <h1>Ticking clock</h1>
        <p>
          One value changes on every tick. Everything below it is inert, and is
          re-rendered, re-serialized and diffed anyway.
        </p>
      </header>

      ${showClock
        ? ClockFace({ time: formatClock(state.now) })
        : html`<p class="empty">
            Clock hidden for this session. Every tick still re-runs the whole
            app here and produces nothing to send.
          </p>`}
      ${Controls({ store, showClock, setShowClock })}

      <ul class="todo-list">
        ${keyed(
          rows,
          (row) => row.id,
          (row) => InertRow({ row }),
        )}
      </ul>

      <footer class="app-footer">
        <span>${rows.length} inert rows</span>
        <span
          >${props.countRenders
            ? `${counter.renders} renders for this session`
            : "render counter off"}</span
        >
      </footer>
    `;
});

/** One hole, one instance: the smallest thing a change can be. */
const ClockFace = component(function ClockFace(props: { time: string }) {
  return html`
    <section class="todo">
      <span class="todo-text">Server time</span>
      <strong>${props.time}</strong>
    </section>
  `;
});

const Controls = component(function Controls(props: {
  store: ClockStore;
  showClock: boolean;
  setShowClock: StateSetter<boolean>;
}) {
  const { showClock, setShowClock } = props;
  const store = useStore(props.store);
  const state = store.state();

  return html`
    <div class="add-form">
      <button
        class="primary"
        type="button"
        .disabled=${state.running}
        @click=${() => store.setRunning(true)}
      >
        Start
      </button>
      <button
        class="primary"
        type="button"
        .disabled=${!state.running}
        @click=${() => store.setRunning(false)}
      >
        Pause
      </button>
      <label class="control-inline">
        <input
          type="checkbox"
          .checked=${showClock}
          @change=${(event: ChangePayload) =>
            setShowClock(event.checked ?? !showClock)}
        />
        Show clock
      </label>
      <span class="revision"
        >${state.running
          ? `ticking every ${state.intervalMs} ms`
          : "paused"}</span
      >
    </div>
  `;
});

const InertRow = component(function InertRow(props: { row: StaticRow }) {
  const { row } = props;

  return html`
    <li class="todo">
      <span class="todo-text">${row.label}</span>
      <span class="revision">${row.region}</span>
      <span class="revision">${row.value}</span>
    </li>
  `;
});

export function createClockApp(options: ClockAppOptions): () => RenderOutput {
  return () =>
    ClockApp({
      store: options.store,
      rows: options.rows,
      initialShowClock: options.showClock,
      countRenders: options.countRenders,
    });
}
