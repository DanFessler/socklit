import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * Who this listen() is.
 *
 * `listen({ name })` wins. Otherwise `package.json` `"name"` from cwd.
 * A Vite `firstPaint()` in the same directory resolves the same way, so a
 * stray process on 8787 fails the handshake instead of becoming the app.
 */
export function resolveAppName(explicit?: string): string {
  if (explicit && explicit.length > 0) return explicit;
  try {
    const raw = readFileSync(join(process.cwd(), "package.json"), "utf8");
    const parsed = JSON.parse(raw) as { name?: unknown };
    if (typeof parsed.name === "string" && parsed.name.length > 0) {
      return parsed.name;
    }
  } catch {
    // No package.json, or it is not JSON.
  }
  return "app";
}
