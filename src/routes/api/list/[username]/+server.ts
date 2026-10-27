import { json } from '@sveltejs/kit';

import { loadAnimePage } from '#lib/server/list-page.js';

import type { RequestHandler } from './$types';

export const GET: RequestHandler = async (event) =>
  json(
    await loadAnimePage({
      ...event,
      params: { domain: 'anilist', username: event.params.username },
      isDataRequest: true,
    })
  );
