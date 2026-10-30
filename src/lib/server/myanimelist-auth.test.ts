import type { Cookies } from '@sveltejs/kit';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  finishSignIn,
  MalSignInError,
  startSignIn,
  withMalToken,
} from '#lib/server/myanimelist-auth.js';
import { getViewer, MalTokenError } from '#lib/server/myanimelist-client.js';
import type { MalSession } from '#lib/server/session.js';

vi.mock('$app/env/private', () => ({ MAL_CLIENT_ID: 'client-id', MAL_CLIENT_SECRET: 'secret' }));
vi.mock('#lib/server/myanimelist-client.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('#lib/server/myanimelist-client.js')>()),
  getViewer: vi.fn(),
}));

const ORIGIN = 'https://yousoro.example';
const user = { id: 12, name: 'Fixture', avatarUrl: null };

function jar() {
  const values = new Map<string, string>();
  const cookies = {
    get: (name: string) => values.get(name),
    set: (name: string, value: string) => void values.set(name, value),
    delete: (name: string) => void values.delete(name),
  } as unknown as Cookies;
  return { values, cookies };
}

function tokens(access = 'access-2', refresh = 'refresh-2') {
  return Response.json({
    token_type: 'Bearer',
    expires_in: 3600,
    access_token: access,
    refresh_token: refresh,
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(tokens('access-1', 'refresh-1')));
  vi.mocked(getViewer).mockResolvedValue(user);
});

describe('MyAnimeList sign-in', () => {
  function started() {
    const { values, cookies } = jar();
    const authorize = new URL(startSignIn(cookies, ORIGIN, '/user/myanimelist/Fixture'));
    return { values, cookies, authorize, state: authorize.searchParams.get('state')! };
  }

  it('asks MyAnimeList for a code with a "plain" PKCE challenge', () => {
    const { values, authorize } = started();
    const pending = JSON.parse(values.get('mal_sign_in')!);

    expect(authorize.origin + authorize.pathname).toBe(
      'https://myanimelist.net/v1/oauth2/authorize'
    );
    expect(Object.fromEntries(authorize.searchParams)).toEqual({
      response_type: 'code',
      client_id: 'client-id',
      state: pending.state,
      redirect_uri: `${ORIGIN}/auth/myanimelist/callback`,
      code_challenge: pending.verifier,
      code_challenge_method: 'plain',
    });
    expect(pending.verifier.length).toBeGreaterThanOrEqual(43);
  });

  it('exchanges the code with the verifier and secret, and comes back where it started', async () => {
    const { cookies, values, state } = started();
    const callback = new URL(`${ORIGIN}/auth/myanimelist/callback?code=the-code&state=${state}`);
    const verifier = JSON.parse(values.get('mal_sign_in')!).verifier;

    const { session, redirectTo } = await finishSignIn(cookies, callback);

    expect(redirectTo).toBe('/user/myanimelist/Fixture');
    expect(session).toMatchObject({ token: 'access-1', refreshToken: 'refresh-1', user });
    const [url, init] = vi.mocked(fetch).mock.calls[0];
    expect(url).toBe('https://myanimelist.net/v1/oauth2/token');
    expect(Object.fromEntries(new URLSearchParams(String(init?.body)))).toEqual({
      client_id: 'client-id',
      client_secret: 'secret',
      grant_type: 'authorization_code',
      code: 'the-code',
      code_verifier: verifier,
      redirect_uri: `${ORIGIN}/auth/myanimelist/callback`,
    });
    // A code can only finish the sign-in once
    expect(values.has('mal_sign_in')).toBe(false);
  });

  it.each([
    ['a sign-in started elsewhere', (state: string) => `code=x&state=${state}x`, 'expired'],
    ['a missing state', () => 'code=x&state=', 'expired'],
    [
      'a refusal on MyAnimeList',
      (state: string) => `error=access_denied&state=${state}`,
      'cancelled',
    ],
  ])('refuses %s', async (_, query, message) => {
    const { cookies, state } = started();
    const callback = new URL(`${ORIGIN}/auth/myanimelist/callback?${query(state)}`);

    const result = finishSignIn(cookies, callback);

    await expect(result).rejects.toBeInstanceOf(MalSignInError);
    await expect(result).rejects.toThrow(message);
    expect(fetch).not.toHaveBeenCalled();
  });
});

describe('withMalToken', () => {
  function signedIn(expiresAt: number) {
    const { values, cookies } = jar();
    const session: MalSession = { token: 'access-1', refreshToken: 'refresh-1', expiresAt, user };
    return { values, event: { cookies, locals: { malSession: session } as App.Locals } };
  }

  it('uses the token while it lasts', async () => {
    const { event } = signedIn(Date.now() + 3_600_000);
    const use = vi.fn().mockResolvedValue('done');

    expect(await withMalToken(event, use)).toBe('done');
    expect(use).toHaveBeenCalledWith('access-1');
    expect(fetch).not.toHaveBeenCalled();
  });

  it('renews an expired token first, and keeps the new one', async () => {
    const { event, values } = signedIn(Date.now() - 1);
    vi.mocked(fetch).mockResolvedValue(tokens());
    const use = vi.fn().mockResolvedValue('done');

    await withMalToken(event, use);

    expect(use).toHaveBeenCalledWith('access-2');
    expect(event.locals.malSession).toMatchObject({ token: 'access-2', refreshToken: 'refresh-2' });
    expect(JSON.parse(values.get('session_mal')!).data.token).toBe('access-2');
    const body = new URLSearchParams(String(vi.mocked(fetch).mock.calls[0][1]?.body));
    expect(body.get('grant_type')).toBe('refresh_token');
    expect(body.get('refresh_token')).toBe('refresh-1');
  });

  it('renews once and tries again when MyAnimeList rejects a token early', async () => {
    const { event } = signedIn(Date.now() + 3_600_000);
    vi.mocked(fetch).mockResolvedValue(tokens());
    const use = vi
      .fn()
      .mockRejectedValueOnce(new MalTokenError('revoked'))
      .mockResolvedValue('done');

    expect(await withMalToken(event, use)).toBe('done');
    expect(use.mock.calls).toEqual([['access-1'], ['access-2']]);
  });

  it('keeps the sign-in when a token it just renewed is rejected', async () => {
    const { event } = signedIn(Date.now() - 1);
    vi.mocked(fetch).mockResolvedValue(tokens());
    const use = vi.fn().mockRejectedValue(new MalTokenError('revoked by another renewal'));

    const result = withMalToken(event, use);

    await expect(result).rejects.toThrow('just renewed');
    await expect(result).rejects.not.toBeInstanceOf(MalTokenError);
    expect(event.locals.malSession).toMatchObject({ token: 'access-2' });
  });

  it('gives up when the sign-in can no longer be renewed', async () => {
    const { event } = signedIn(Date.now() - 1);
    vi.mocked(fetch).mockResolvedValue(Response.json({ error: 'invalid_grant' }, { status: 400 }));

    await expect(withMalToken(event, vi.fn())).rejects.toBeInstanceOf(MalTokenError);
  });
});
