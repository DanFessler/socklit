import { describe, expect, it } from "vitest";

import { signTicket, verifyTicket } from "../server/public";

const SECRET = "test-secret";

describe("signTicket / verifyTicket", () => {
  it("round-trips a payload", () => {
    const payload = { id: "ada", name: "Ada" };
    const token = signTicket(payload, SECRET);
    expect(verifyTicket<typeof payload>(token, SECRET)).toEqual(payload);
  });

  it("returns null when the secret does not match", () => {
    const token = signTicket({ id: "ada" }, SECRET);
    expect(verifyTicket(token, "other-secret")).toBeNull();
  });

  it("returns null when the token is tampered with", () => {
    const token = signTicket({ id: "ada" }, SECRET);
    const [body, sig] = token.split(".");
    const flipped = body!.endsWith("A") ? `${body!.slice(0, -1)}B` : `${body!.slice(0, -1)}A`;
    expect(verifyTicket(`${flipped}.${sig}`, SECRET)).toBeNull();
    expect(verifyTicket(`${body}.${sig}x`, SECRET)).toBeNull();
    expect(verifyTicket("not-a-ticket", SECRET)).toBeNull();
  });

  it("rejects an expired exp", () => {
    const token = signTicket({ id: "ada", exp: Math.floor(Date.now() / 1000) - 30 }, SECRET);
    expect(verifyTicket(token, SECRET)).toBeNull();
  });

  it("accepts a future exp", () => {
    const payload = { id: "ada", exp: Math.floor(Date.now() / 1000) + 60 };
    const token = signTicket(payload, SECRET);
    expect(verifyTicket<typeof payload>(token, SECRET)).toEqual(payload);
  });
});
