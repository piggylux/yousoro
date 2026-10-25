/** Only allows paths on this site, so signing in or out can't redirect elsewhere. */
export function safeRedirectPath(path: unknown): string {
  if (typeof path !== 'string' || !path.startsWith('/')) return '/home';

  // Resolve the path the way a browser would, which also drops tabs and newlines and treats \ as /
  // (so "/\t/evil.example" means "//evil.example"), and keep it only if it stays on this site
  const base = 'http://localhost';
  const url = new URL(path, base);
  return url.origin === base ? `${url.pathname}${url.search}${url.hash}` : '/home';
}
