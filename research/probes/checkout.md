# Checkout wizard

**Forces S4 and A8: what is a session, and does anything outlive the socket?**

The result in one paragraph. **A session is a connection, and that is not
enough.** The probe has three homes for a four-step draft. Put the cart and the
address in `useState` and a reconnect — the laptop sleeping — wipes them. Put
the same draft in a per-user row of the store and reconnect restores it, but a
second tab of the same person shares the row: advancing the step in one tab
moves the other. Put it in `useDurable` and reconnect restores it, a second
tab has its own cell, and `{ share: "user" }` is the author saying the other
tab should share. Placed orders, which belong in the store, survive either
way. A help flag that is always `useState` dies even when the draft is
durable. Those are not three bugs. They are three lifetimes. S4's answer is
**yes, three tiers, and the author picks at the hook**. A8 is the name for
the middle one; the runtime now has it.

## What the probe does

A mug, a tote, and a cap. Four steps: cart, address, last four digits, review
and place. Catalog and orders are the JSON file. The wizard is not.

```
http://localhost:5182/?probe=checkout&user=ada
http://localhost:5182/?probe=checkout&user=ada&share=user
http://localhost:5182/?probe=checkout&user=ada&draft=state
http://localhost:5182/?probe=checkout&user=ada&draft=store
```

`?draft=durable` (default) holds cart, step, address and payment in
`useDurable("wizard")`. Reconnect of this tab restores them. A second tab
does not share, unless `?share=user`. `?draft=state` holds them in
`useState`. `?draft=store` holds them in `drafts[user]` on the same store
as the orders. The help note is `useState` in every mode. Close the tab
and open it again — that is the laptop. Open two tabs with the same
`?user=`.

Handlers name outcomes: set this quantity, go to this step, write this address,
place this draft. Place subtracts stock and appends an order. A second place of
the same empty cart is refused.

## Measurements

From `npx vitest run test/probes/checkout.test.ts`. Each reconnect is a new
`Runtime.attach` against the same store. That is a dropped socket, not a
reload of the process.

| Draft home | Reconnect | Second tab, same user | Other user |
| --- | --- | --- | --- |
| `useState` | cart and step gone | independent | independent |
| `useDurable` (default) | cart and step restored | independent | isolated |
| `useDurable` `{ share: "user" }` | cart and step restored | **same cell** | isolated |
| store row | cart and step restored | **same row** — step and cart are shared | isolated |
| help flag (`useState` always) | gone | independent | independent |
| placed order (store always) | still there | visible in both | isolated |

No `/metrics` sweep is required. S4 is not a cost question. The odds probe
already priced what a reconnect has to rebuild (350 KB retained). This probe
asks which of those bytes were *allowed* to die.

## What it forced

### S4: what is a session?

**Three tiers, picked by the author, visible in the hook name.**

1. **Store.** Catalog, stock, orders. Everyone, or everyone who should see
   this user's receipts. Survives disconnect, deploy, and a second tab. The
   runtime has this.
2. **This person, this task.** The wizard. Must survive the socket. Must not
   be the other tab's stepper unless the author says so. `useDurable` is
   this. Default is this tab; `{ share: "user" }` is the other half.
   `?draft=store` remains as the contrast that fails the second-tab half.
3. **This connection.** The help flag, a hover, a toast. Allowed to die.
   `useState` is this, and only this.

Identity (`?user=`, a cookie, `grant`) names the person. It is not a place to
put the draft. S5's visitor with no session at all is a fourth audience, not
a fourth lifetime, and this probe did not touch it. That is now
[first paint](first-paint.md).

Who decides: **the author.** The probe did not find a rule that could assign
tiers automatically. A cart is a store in a supermarket and a draft in a
wizard. The framework's job is to make the three calls read differently so
the choice is not a comment on a `useState`.

### A8: durable sessions

**`useDurable`, keyed by identity and tab, not by socket.** That is tier 2.
The name is the author's key. Values are JSON. Default scope is this tab
(`?socklit_tab=` from the replica's `sessionStorage`). `{ share: "user" }`
is every tab of this person. `listen({ durableFile })` writes the vault so
a deploy keeps in-flight work; omit it and reconnect still works, a process
exit does not.

Whether two tabs *should* share a checkout is an author choice. The
primitive can say no, which is the default.

## Where I hit a wall

**The wall was the runtime, and it has been crossed.** Session hook state is
still a `HookHost` on the connection — `useState` still dies with the
socket. The vault is per runtime, keyed by the author-chosen name plus
identity plus tab. A test can drop a socket and get the draft back. A
process bounce still needs `durableFile`; memory is the default.

## What a reader should not conclude

- **That every draft belongs in `useDurable`.** The help flag is correctly
  `useState`. A placed order is correctly the store. The probe's point is that
  those are different sentences.
- **That two tabs must not share a cart.** Some products want that. They can
  put the cart in the store. They should not have to put the *stepper* there
  to get reconnect.
- **That this measured reconnect cost.** It did not. It classified lifetimes.
- **That `?user=` is login.** It is a query string, like the other probes.
  `identify` / `grant` already name a person across sockets. They do not hold
  a wizard.
