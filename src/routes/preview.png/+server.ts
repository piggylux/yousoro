import { renderSitePreview } from '#lib/server/preview-image.js';

import type { RequestHandler } from './$types';

// Drawn once at build time and served as a static file
export const prerender = true;

export const GET: RequestHandler = () => renderSitePreview('public, max-age=86400');
