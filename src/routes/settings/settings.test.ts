import type { Cookies, RequestEvent } from '@sveltejs/kit';
import { describe, expect, it, vi } from 'vitest';

import { getPreferences } from '#lib/server/preferences.js';
import { DEFAULT_PREFERENCES, type Theme } from '#lib/types/preferences.js';

import { load } from '../+layout.server';
import { handle } from '../../hooks.server';
import { actions } from './+page.server';

vi.mock('$app/env', () => ({ building: false }));

describe('saving settings in a native form submission', () => {
  it.each<[Theme, Theme]>([
    ['system', 'dark'],
    ['dark', 'light'],
    ['light', 'system'],
  ])('renders the saved %s → %s theme in the same response', async (before, theme) => {
    const jar = new Map([
      ['preferences', JSON.stringify({ v: 1, data: { ...DEFAULT_PREFERENCES, theme: before } })],
    ]);
    const cookies = {
      get: (name: string) => jar.get(name),
      set: (name: string, value: string) => void jar.set(name, value),
    } as unknown as Cookies;
    const event = {
      cookies,
      locals: {},
      request: new Request('http://localhost/settings', {
        method: 'POST',
        body: new URLSearchParams({
          theme,
          showMature: 'on',
          blurMature: 'on',
          cardSize: 'small',
          downloadLanguage: 'french',
          downloadVersion: 'subbed',
        }),
      }),
    } as RequestEvent<Record<string, never>, '/settings'>;
    const expected = {
      ...DEFAULT_PREFERENCES,
      theme,
      cardSize: 'small',
      downloadLanguage: 'french',
      downloadVersion: 'subbed',
    };

    const response = await handle({
      event,
      resolve: async (_currentEvent, options) => {
        await actions.default!(event);
        expect(
          await load({
            ...event,
            parent: async () => ({}),
            depends: () => {},
            untrack: (fn) => fn(),
          })
        ).toMatchObject({ preferences: expected });
        const html = await options!.transformPageChunk!({
          html: '<html lang="en" %yousoro.theme%><body></body></html>',
          done: true,
        });
        return new Response(html);
      },
    });

    expect(getPreferences(cookies)).toEqual(expected);
    expect(await response.text()).toBe(
      theme === 'system'
        ? '<html lang="en" ><body></body></html>'
        : `<html lang="en" data-theme="${theme}"><body></body></html>`
    );
  });
});
