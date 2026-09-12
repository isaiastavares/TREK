import { readEnv } from './env';

/**
 * Substitutes the `{appName}` placeholder that static text carries when it has
 * to name this install — the external-notification locales, and every MCP
 * description, which is written once next to its handler but read by a client
 * per session.
 *
 * `appName` defaults to the live product name; pass it explicitly where the
 * substitution lands in a context with its own escaping rules (HTML mail).
 * Text with no placeholder comes back untouched, so a locale that has not been
 * updated yet renders the name it was written with rather than breaking.
 */
export function withAppName(text: string, appName: string = readEnv().app.appName): string {
  return text.replaceAll('{appName}', appName);
}

/**
 * The MCP server's advertised name, in one place because four surfaces have to
 * agree on it: the `initialize` result, the protected-resource metadata the SDK
 * router serves, the `/.well-known` document this app serves itself, and the
 * `realm` of every `WWW-Authenticate` challenge. A client that sees two
 * different names for one server has no way to tell they are the same server.
 *
 * Live read, like getAppUrl() next door — never cached.
 */
export function getMcpServerName(): string {
  return `${readEnv().app.appName} MCP`;
}

/**
 * The User-Agent this server sends when it calls something itself — the GitHub
 * releases API, a plugin registry, a plugin tarball. Three call sites, one
 * spelling: an operator reading a rate-limit report or an allowlist needs the
 * same token to appear in all of them.
 */
export function serverUserAgent(): string {
  return `${readEnv().app.appName}-Server`;
}
