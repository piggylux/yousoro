import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import {
  getPageSeo,
  HOME_TITLE,
  jsonLdScript,
  listPreviewImage,
  serializeJsonLd,
  SHARE_IMAGE,
  SITE_ORIGIN,
  WEBSITE_SCHEMA,
} from '#lib/seo.js';

describe('search metadata', () => {
  it('uses the production canonical for the landing page without tracking parameters', () => {
    expect(getPageSeo(new URL(`${SITE_ORIGIN}/home?utm_source=fixture#intro`))).toMatchObject({
      title: HOME_TITLE,
      canonical: `${SITE_ORIGIN}/home`,
      noindex: false,
      home: true,
    });
  });

  it('canonicalizes list variants and preserves the calendar title', () => {
    const seo = getPageSeo(
      new URL(`${SITE_ORIGIN}/user/anilist/Show%20Fan?view=calendar&utm_source=test`)
    );
    expect(seo.canonical).toBe(`${SITE_ORIGIN}/user/anilist/Show%20Fan`);
    expect(seo.title).toContain("Show Fan's Anime Episode Calendar");
    expect(seo.noindex).toBe(false);
  });

  it('uses AniList’s resolved username so alternate case and URL encodings share one canonical', () => {
    for (const path of [
      '/user/anilist/showfan',
      '/user/anilist/SHOWFAN',
      '/user/anilist/%53howFan',
    ]) {
      const seo = getPageSeo(new URL(`${SITE_ORIGIN}${path}?view=calendar`), 200, 'ShowFan');
      expect(seo.canonical).toBe(`${SITE_ORIGIN}/user/anilist/ShowFan`);
      expect(seo.title).toContain("ShowFan's Anime Episode Calendar");
      expect(seo.noindex).toBe(false);
    }
  });

  it('encodes resolved names as one URL segment and never canonicalizes an error', () => {
    const url = new URL(`${SITE_ORIGIN}/user/anilist/fixture`);
    expect(getPageSeo(url, 200, 'Show & Friends').canonical).toBe(
      `${SITE_ORIGIN}/user/anilist/Show%20%26%20Friends`
    );
    expect(getPageSeo(url, 404, 'Show & Friends').canonical).toBeUndefined();
  });

  it('previews a list and its calendar with the list’s own image, under its resolved name', () => {
    for (const query of ['', '?view=calendar']) {
      const seo = getPageSeo(
        new URL(`${SITE_ORIGIN}/user/anilist/showfan${query}`),
        200,
        'Show Fan'
      );
      expect(seo.image).toEqual({
        url: `${SITE_ORIGIN}/user/anilist/Show%20Fan/preview.jpg`,
        type: 'image/jpeg',
        alt: "Show Fan's anime watching list",
      });
    }
  });

  it.each(['/home', '/settings', '/user/anilist/fixture/friends'])(
    'previews other pages with the site’s image: %s',
    (path) => {
      expect(getPageSeo(new URL(`${SITE_ORIGIN}${path}`)).image.url).toBe(SHARE_IMAGE);
    }
  );

  it('falls back to the site’s image for a list that failed to load', () => {
    expect(getPageSeo(new URL(`${SITE_ORIGIN}/user/anilist/fixture`), 404).image.url).toBe(
      SHARE_IMAGE
    );
  });

  it.each([
    '/settings',
    '/auth/anilist/callback',
    '/api/nyaa',
    '/user/anilist/fixture/friends',
    '/missing',
    '/user/unknown/fixture',
    '/user/anilist/%E0%A4%A',
  ])('excludes non-public and invalid routes: %s', (path) => {
    expect(getPageSeo(new URL(`${SITE_ORIGIN}${path}`)).noindex).toBe(true);
  });

  it.each([404, 429, 500, 503])(
    'does not canonicalize an error as a successful page (%s)',
    (status) => {
      expect(getPageSeo(new URL(`${SITE_ORIGIN}/home`), status)).toMatchObject({
        noindex: true,
        canonical: undefined,
        home: false,
      });
    }
  );

  it.each(['http://localhost:5173', 'https://yousoro-preview.vercel.app', 'https://example.com'])(
    'keeps non-production hosts out of search: %s',
    (origin) => {
      expect(getPageSeo(new URL(`${origin}/home`))).toMatchObject({
        canonical: `${SITE_ORIGIN}/home`,
        noindex: true,
      });
    }
  );

  it('escapes script-closing input while retaining valid structured data', () => {
    const data = { name: '</script><script>alert(1)</script>' };
    const json = serializeJsonLd(data);
    expect(json).not.toContain('<');
    expect(JSON.parse(json)).toEqual(data);
    expect(jsonLdScript(data).match(/<\/script>/g)).toHaveLength(1);
    expect(JSON.parse(serializeJsonLd(WEBSITE_SCHEMA)).url).toBe(`${SITE_ORIGIN}/`);
  });

  it('keeps the sitemap, robots declaration, manifest and share image aligned with the site', () => {
    const sitemap = readFileSync(new URL('../../static/sitemap.xml', import.meta.url), 'utf8');
    const robots = readFileSync(new URL('../../static/robots.txt', import.meta.url), 'utf8');
    const manifest = JSON.parse(
      readFileSync(new URL('../../static/site.webmanifest', import.meta.url), 'utf8')
    );
    expect(sitemap).toContain(`<loc>${getPageSeo(new URL(`${SITE_ORIGIN}/home`)).canonical}</loc>`);
    expect(sitemap).not.toContain('/user/');
    expect(robots).toContain(`Sitemap: ${SITE_ORIGIN}/sitemap.xml`);
    expect(robots).not.toContain('Disallow: /settings');
    expect(manifest.start_url).toBe('/home');
    // Both preview images are drawn by a route of the same path
    for (const image of [SHARE_IMAGE, listPreviewImage('fixture')]) {
      const route = new URL(image).pathname.replace(
        '/user/anilist/fixture/',
        '/user/[domain]/[username]/'
      );
      expect(
        readFileSync(new URL(`../routes${route}/+server.ts`, import.meta.url), 'utf8')
      ).toContain('export const GET');
    }
  });
});
