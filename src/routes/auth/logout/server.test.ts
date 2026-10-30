import type { Cookies } from '@sveltejs/kit';
import { describe, expect, it } from 'vitest';

import { POST } from './+server';

async function signOut(fields: Record<string, string>) {
  const deleted: string[] = [];
  const cookies = { delete: (name: string) => void deleted.push(name) } as unknown as Cookies;
  const request = new Request('http://localhost/auth/logout', {
    method: 'POST',
    body: new URLSearchParams({ redirectTo: '/home', ...fields }),
  });
  await expect(
    POST({ request, cookies } as unknown as Parameters<typeof POST>[0])
  ).rejects.toMatchObject({ status: 303, location: '/home' });
  return deleted;
}

describe('signing out', () => {
  it('signs out of every service from the header', async () => {
    expect(await signOut({})).toEqual(['session', 'session_mal']);
  });

  it.each([
    ['anilist', ['session']],
    ['myanimelist', ['session_mal']],
  ])('signs out of %s alone from the account settings', async (service, cookies) => {
    expect(await signOut({ service })).toEqual(cookies);
  });
});
