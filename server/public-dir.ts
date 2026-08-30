import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import type { IncomingMessage, ServerResponse } from "node:http";
import path from "node:path";

const TYPES: Record<string, string> = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".ico": "image/x-icon",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".map": "application/json; charset=utf-8",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".txt": "text/plain; charset=utf-8",
  ".webp": "image/webp",
  ".woff2": "font/woff2",
};

/**
 * Serve a file from `root` for this GET. Returns whether a response was sent.
 * Refuses paths that escape the root.
 */
export async function servePublicFile(
  root: string,
  request: IncomingMessage,
  response: ServerResponse,
): Promise<boolean> {
  if (request.method !== "GET" && request.method !== "HEAD") return false;

  const url = new URL(request.url ?? "/", "http://127.0.0.1");
  if (url.pathname === "/ws" || url.pathname === "/session" || url.pathname === "/health") {
    return false;
  }

  const relative = url.pathname === "/" ? "index.html" : decodeURIComponent(url.pathname);
  const resolved = path.resolve(root, `.${path.posix.normalize(`/${relative}`)}`);
  const rootResolved = path.resolve(root);
  if (resolved !== rootResolved && !resolved.startsWith(rootResolved + path.sep)) {
    response.writeHead(403);
    response.end();
    return true;
  }

  try {
    const info = await stat(resolved);
    if (!info.isFile()) return false;
  } catch {
    return false;
  }

  const type = TYPES[path.extname(resolved).toLowerCase()] ?? "application/octet-stream";
  response.writeHead(200, { "content-type": type });
  if (request.method === "HEAD") {
    response.end();
    return true;
  }
  createReadStream(resolved).pipe(response);
  return true;
}
