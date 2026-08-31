import { html } from "lit-html";

import type { SubmitPayload } from "../../../shared/protocol";
import { component, useDurable, useState, useStore } from "../../component";
import { keyed } from "../../keyed";
import {
  cartCount,
  emptyDraft,
  formatMoney,
  isCompleteAddress,
  isLast4,
  linesOf,
  type CheckoutStore,
  type Draft,
  type Payment,
  type Step,
} from "./store";

/**
 * Where the wizard lives.
 *
 * `durable` is the recommended home: `useDurable`. Survives this tab's
 * reconnect. A second tab has its own cell unless `share` is `user`.
 * `state` is a connection. `store` is a per-user row — reconnect works,
 * two tabs clobber.
 */
export type DraftHome = "durable" | "state" | "store";

export const CheckoutApp = component(function CheckoutApp(props: {
  store: CheckoutStore;
  user: string;
  home: DraftHome;
  share: "tab" | "user";
}) {
  const store = useStore(props.store);
  const [local, setLocal] = useState(emptyDraft);
  const [kept, setKept] = useDurable("wizard", emptyDraft, {
    share: props.share,
  });
  const [help, setHelp] = useState(false);

  const draft =
    props.home === "store"
      ? store.draft(props.user)
      : props.home === "durable"
        ? kept
        : local;
  const write = (next: Draft): void | Promise<void> => {
    if (props.home === "state") {
      setLocal(next);
      return;
    }
    if (props.home === "durable") {
      setKept(next);
      return;
    }
    return store.saveDraft(props.user, next);
  };

  const orders = store.ordersFor(props.user);

  return html`
    <header class="app-header">
      <h1>Checkout wizard</h1>
      <p>
        ${props.user} · draft in ${props.home}${
          props.home === "durable" ? ` (${props.share})` : ""
        }
        · ${cartCount(draft.cart)} in cart
        · ${orders.length} orders
      </p>
    </header>

    <ol class="todo-list">
      <li class="todo">
        <span class="todo-text">Step ${draft.step} of 4</span>
        <button
          class="link"
          type="button"
          data-probe="help"
          @click=${() => setHelp(!help)}
        >
          ${help ? "Hide note" : "What dies"}
        </button>
      </li>
    </ol>
    ${help
      ? html`<p class="empty" data-probe="help-body">
          The help flag is always <code>useState</code>. Close the socket and
          it is gone, even when the draft lives in the store. A reconnect is
          the laptop sleeping.
        </p>`
      : null}

    ${draft.step === 1
      ? CartStep({ store, draft, write })
      : draft.step === 2
        ? AddressStep({ draft, write })
        : draft.step === 3
          ? PayStep({ draft, write })
          : ReviewStep({ store, user: props.user, draft, write, home: props.home })}

    ${orders.length > 0
      ? html`
          <h2>Placed</h2>
          <ul class="todo-list">
            ${keyed(
              orders,
              (order) => order.id,
              (order) => html`
                <li class="todo">
                  <span class="todo-text" data-probe="order:${order.id}">
                    ${order.id} · ending ${order.last4} ·
                    ${order.lines.map((line) => `${line.qty}× ${line.name}`).join(", ")}
                  </span>
                </li>
              `,
            )}
          </ul>
        `
      : null}
  `;
});

const CartStep = component(function CartStep(props: {
  store: CheckoutStore;
  draft: Draft;
  write: (next: Draft) => void;
}) {
  const catalog = props.store.state().catalog;
  const { draft, write } = props;

  return html`
    <ul class="todo-list">
      ${keyed(
        catalog,
        (item) => item.id,
        (item) => {
          const qty = draft.cart[item.id] ?? 0;
          return html`
            <li class="todo">
              <span class="todo-text">
                ${item.name} · ${formatMoney(item.priceCents)} · ${item.stock} left
              </span>
              <span class="revision" data-probe="qty">${qty}</span>
              <button
                class="link"
                type="button"
                data-probe="sub"
                @click=${() =>
                  write({
                    ...draft,
                    cart: { ...draft.cart, [item.id]: Math.max(0, qty - 1) },
                  })}
              >
                −
              </button>
              <button
                class="link"
                type="button"
                data-probe="add"
                @click=${() =>
                  write({
                    ...draft,
                    cart: {
                      ...draft.cart,
                      [item.id]: Math.min(item.stock, qty + 1),
                    },
                  })}
              >
                +
              </button>
            </li>
          `;
        },
      )}
    </ul>
    ${cartCount(draft.cart) > 0
      ? Nav({ step: 1, next: 2, write, draft })
      : Nav({ step: 1, write, draft })}
  `;
});

const AddressStep = component(function AddressStep(props: {
  draft: Draft;
  write: (next: Draft) => void;
}) {
  const { draft, write } = props;
  const { address } = draft;

  return html`
    <form
      class="add-form"
      data-probe="address"
      @submit=${(event: SubmitPayload) =>
        write({
          ...draft,
          address: {
            name: event.fields["name"] ?? "",
            street: event.fields["street"] ?? "",
            city: event.fields["city"] ?? "",
          },
          step: 3,
        })}
    >
      <input name="name" value="${address.name}" maxlength="80" required autocomplete="off" />
      <input name="street" value="${address.street}" maxlength="120" required autocomplete="off" />
      <input name="city" value="${address.city}" maxlength="80" required autocomplete="off" />
      <button class="primary" type="submit">Continue</button>
    </form>
    ${Nav({ step: 2, back: 1, write, draft })}
  `;
});

const PayStep = component(function PayStep(props: {
  draft: Draft;
  write: (next: Draft) => void;
}) {
  const { draft, write } = props;

  return html`
    <form
      class="add-form"
      data-probe="pay"
      @submit=${(event: SubmitPayload) => {
        const last4 = (event.fields["last4"] ?? "").replace(/\D/g, "").slice(-4);
        return write({ ...draft, payment: { last4 }, step: 4 });
      }}
    >
      <input
        name="last4"
        value="${draft.payment.last4}"
        inputmode="numeric"
        maxlength="4"
        required
        autocomplete="off"
      />
      <button class="primary" type="submit">Review</button>
    </form>
    ${Nav({ step: 3, back: 2, write, draft })}
  `;
});

const ReviewStep = component(function ReviewStep(props: {
  store: CheckoutStore;
  user: string;
  draft: Draft;
  write: (next: Draft) => void;
  home: DraftHome;
}) {
  const { store, user, draft, write, home } = props;
  const lines = linesOf(store.state().catalog, draft.cart);
  const total = lines.reduce((sum, line) => sum + line.priceCents * line.qty, 0);
  const ready =
    lines.length > 0 &&
    isCompleteAddress(draft.address) &&
    isLast4(draft.payment.last4);

  return html`
    <ul class="todo-list">
      ${keyed(
        lines,
        (line) => line.id,
        (line) => html`
          <li class="todo">
            <span class="todo-text">
              ${line.qty}× ${line.name} · ${formatMoney(line.priceCents * line.qty)}
            </span>
          </li>
        `,
      )}
      <li class="todo">
        <span class="todo-text">
          ${draft.address.name}, ${draft.address.street}, ${draft.address.city}
        </span>
      </li>
      <li class="todo">
        <span class="todo-text">Card ending ${draft.payment.last4}</span>
      </li>
      <li class="todo">
        <span class="todo-text">Total ${formatMoney(total)}</span>
      </li>
    </ul>
    <div class="add-form">
      <button
        class="primary"
        type="button"
        data-probe="place"
        @click=${() => {
          if (!ready) return;
          return store.place(user, draft).then(() => {
            if (home !== "store") write(emptyDraft());
          });
        }}
      >
        Place order
      </button>
    </div>
    ${Nav({ step: 4, back: 3, write, draft })}
  `;
});

const Nav = component(function Nav(props: {
  step: Step;
  back?: Step;
  next?: Step;
  draft: Draft;
  write: (next: Draft) => void;
}) {
  const { draft, write } = props;
  return html`
    <div class="add-form">
      ${props.back
        ? html`<button
            class="link"
            type="button"
            data-probe="back"
            @click=${() => write({ ...draft, step: props.back as Step })}
          >
            Back
          </button>`
        : null}
      ${props.next
        ? html`<button
            class="primary"
            type="button"
            data-probe="next"
            @click=${() => write({ ...draft, step: props.next as Step })}
          >
            Continue
          </button>`
        : null}
    </div>
  `;
});

export type { Payment };
