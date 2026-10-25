import { describe, expect, it } from 'vitest';

import {
  hiddenSectionsCookie,
  hiddenSectionsInBrowser,
  parseHiddenSections,
  toggleHidden,
} from '#lib/hidden-sections.js';

describe('parseHiddenSections', () => {
  it('reads the hidden sections, in the list’s order', () => {
    expect(parseHiddenSections('other,caught-up')).toEqual(['caught-up', 'other']);
  });

  it('drops unknown sections and repeats', () => {
    expect(parseHiddenSections('other,nope,behind,other,')).toEqual(['behind', 'other']);
  });

  it('hides nothing without a cookie, or with an empty one', () => {
    expect(parseHiddenSections(undefined)).toEqual([]);
    expect(parseHiddenSections('')).toEqual([]);
  });
});

describe('hiddenSectionsCookie', () => {
  it('lists the hidden sections for every page, for a year', () => {
    expect(hiddenSectionsCookie(['rewatching', 'caught-up'])).toBe(
      'hidden-sections=rewatching,caught-up; path=/; max-age=31536000; samesite=lax'
    );
  });

  it('reads back what it writes', () => {
    const value = hiddenSectionsCookie(['behind', 'other']).split(';')[0].split('=')[1];
    expect(parseHiddenSections(value)).toEqual(['behind', 'other']);
  });
});

describe('hiddenSectionsInBrowser', () => {
  it('finds the hidden sections among the browser’s cookies', () => {
    expect(hiddenSectionsInBrowser('theme=dark; hidden-sections=other,behind; x=1')).toEqual([
      'behind',
      'other',
    ]);
  });

  it('hides nothing when the cookie isn’t there', () => {
    expect(hiddenSectionsInBrowser('theme=dark')).toEqual([]);
    expect(hiddenSectionsInBrowser('')).toEqual([]);
  });

  it('doesn’t take a cookie whose name only ends the same way', () => {
    expect(hiddenSectionsInBrowser('old-hidden-sections=other')).toEqual([]);
  });
});

describe('toggleHidden', () => {
  it('hides a shown section, keeping the list’s order', () => {
    expect(toggleHidden(['other'], 'behind')).toEqual(['behind', 'other']);
  });

  it('shows a hidden section again', () => {
    expect(toggleHidden(['behind', 'other'], 'behind')).toEqual(['other']);
  });

  it('comes back to where it started when toggled twice', () => {
    const hidden = toggleHidden(toggleHidden(['caught-up'], 'rewatching'), 'rewatching');
    expect(hidden).toEqual(['caught-up']);
  });
});
