import assert from "node:assert/strict";
import { test } from "node:test";

import { displayName, guestById, ticketsFromJson } from "./tickets";

test("loads legacy token-to-preset-id records", () => {
  const loaded = ticketsFromJson({
    "old-token": "ada",
    "bad-token": "nobody",
  });
  assert.deepEqual(loaded.get("old-token"), { id: "ada", name: "Ada Vale" });
  assert.equal(loaded.has("bad-token"), false);
});

test("loads persisted guest records", () => {
  const loaded = ticketsFromJson({
    "new-token": { id: "guest-1", name: "  Pat Lane  " },
  });
  assert.deepEqual(loaded.get("new-token"), { id: "guest-1", name: "Pat Lane" });
});

test("resolves leftover preset seat ids", () => {
  assert.equal(displayName("ada"), "Ada Vale");
  assert.equal(guestById("ada")?.name, "Ada Vale");
  assert.equal(displayName("missing"), "Unknown");
  assert.equal(displayName(null), "Empty");
});
