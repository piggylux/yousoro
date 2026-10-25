/**
 * Cookie values are JSON tagged with the version of their format, `{"v":2,"data":…}`, so a format
 * can change later without misreading cookies that browsers still have from before.
 *
 * To change a format: bump `version`, update `parse` to check the new shape, and add a migration
 * from the old version to the next one. Cookies are migrated step by step up to the current
 * version, so every old format keeps working. A cookie from an unknown or newer version, or one
 * that doesn't fit, is ignored, as if there were no cookie.
 */
export type CookieFormat<T> = {
  /** The current format version, from 1 */
  version: number;
  /** Checks data in the current format and returns it, or null when it doesn't fit */
  parse: (data: unknown) => T | null;
  /**
   * `migrations[n]` turns version n's data into version n + 1's. Version 0 is a cookie written
   * before versioning existed, which is the whole JSON value rather than its `data`.
   */
  migrations?: Record<number, (data: unknown) => unknown>;
};

function isTagged(value: unknown): value is { v: number; data: unknown } {
  return (
    typeof value === 'object' &&
    value !== null &&
    'v' in value &&
    Number.isInteger(value.v) &&
    'data' in value
  );
}

export function readVersioned<T>(raw: string | undefined, format: CookieFormat<T>): T | null {
  if (!raw) return null;

  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return null;
  }

  let version = isTagged(value) ? value.v : 0;
  let data = isTagged(value) ? value.data : value;

  // Written by a newer version of the app, so this one can't know what it means
  if (version > format.version || version < 0) return null;

  while (version < format.version) {
    const migrate = format.migrations?.[version];
    if (!migrate) return null;
    data = migrate(data);
    version += 1;
  }

  return format.parse(data);
}

export function writeVersioned<T>(data: T, format: CookieFormat<T>): string {
  return JSON.stringify({ v: format.version, data });
}
