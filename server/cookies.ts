/**
 * Parse a Cookie header into a name → value map.
 *
 * First-week `identify` can read `request.cookies.session` when the page
 * and the protocol share an origin. Two-port Vite + listen does not;
 * use `grant` / `socklit_session` there.
 */
export function parseCookies(header: string | undefined): Record<string, string> {
  const cookies: Record<string, string> = {};
  if (!header) return cookies;

  for (const part of header.split(";")) {
    const cut = part.indexOf("=");
    if (cut === -1) continue;
    const name = part.slice(0, cut).trim();
    if (!name) continue;
    const raw = part.slice(cut + 1).trim();
    try {
      cookies[name] = decodeURIComponent(raw);
    } catch {
      cookies[name] = raw;
    }
  }

  return cookies;
}
