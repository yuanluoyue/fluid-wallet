/**
 * Turning a page-supplied path into a provider URL.
 *
 * The rule that makes the raw proxy safe: the page never chooses the host. It
 * chooses a path, and the wallet glues that path onto the base URL the *user*
 * configured. Everything here is pure so both sides of the protocol — the
 * wallet that makes the request and the SDK that fakes one in dev — agree.
 */

/** Strips a trailing slash, so `https://x/v1/` and `https://x/v1` behave the same. */
function basePath(baseUrl: string): string {
  const { pathname } = new URL(baseUrl);
  return pathname.replace(/\/+$/, "");
}

function normalizePath(path: string): string {
  return path.startsWith("/") ? path : `/${path}`;
}

/**
 * Path below the provider base URL.
 *
 * Apps keep using the base URL their provider SDK already had, so the incoming
 * path usually repeats the provider's own prefix (`/v1/chat/completions` for a
 * base URL of `https://api.deepseek.com/v1`). Repeating it would produce
 * `/v1/v1/chat/completions`, so a matching prefix is removed once.
 */
export function providerPath(baseUrl: string, requestPath: string): string {
  const prefix = basePath(baseUrl);
  const path = normalizePath(requestPath);
  if (prefix && (path === prefix || path.startsWith(`${prefix}/`))) {
    return normalizePath(path.slice(prefix.length));
  }
  return path;
}

/** Absolute URL the wallet should call for a page-supplied path. */
export function resolveProviderUrl(baseUrl: string, requestPath: string): string {
  const { origin } = new URL(baseUrl);
  return `${origin}${basePath(baseUrl)}${providerPath(baseUrl, requestPath)}`;
}
