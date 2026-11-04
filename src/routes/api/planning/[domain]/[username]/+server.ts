import { json } from '@sveltejs/kit';

import { loadPlanningPage } from '#lib/server/list-page.js';

import type { RequestHandler } from './$types';

export const GET: RequestHandler = async (event) => json(await loadPlanningPage(event));
