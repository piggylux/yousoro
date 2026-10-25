import { describe, expect, it } from 'vitest';

import { nyaaQuery, nyaaSearchUrl, nyaaSite } from '#lib/nyaa.js';
import { DOWNLOAD_LANGUAGES, DOWNLOAD_VERSIONS } from '#lib/types/preferences.js';

// Every search for episode 1 of "Show" starts with these phrases
const SHOW_PHRASES = '("Show - 01"|"Show 01"|"Show - S01E01"|"Show S01E01"|"(Show) - 01")';

describe('nyaaQuery', () => {
  it('looks for the title followed right away by the episode number, with or without a dash', () => {
    expect(nyaaQuery({ title: 'Natsu to Hako', episode: 5 }).query).toBe(
      '("Natsu to Hako - 05"|"Natsu to Hako 05"|"Natsu to Hako - S01E05"|"Natsu to Hako S01E05"|"(Natsu to Hako) - 05") -batch'
    );
  });

  it('reads a number from 2 to 9 ending the title as its season', () => {
    const { query } = nyaaQuery({ title: 'Isekai Quartet 3', episode: 5 });
    for (const phrase of [
      '"Isekai Quartet 3 05"',
      '"Isekai Quartet S3 - 05"',
      '"Isekai Quartet 3rd Season - 05"',
      '"Isekai Quartet S03E05"',
    ]) {
      expect(query).toContain(phrase);
    }
  });

  it('keeps a season 1 code when a number ending the title may be part of the name', () => {
    const { query } = nyaaQuery({ title: 'Kaiju No. 8', episode: 5 });
    expect(query).toContain('"Kaiju No. 8 S01E05"');
    expect(query).toContain('"Kaiju No. - S08E05"');
  });

  it.each([
    ['Overlord IV', '"Overlord S04E03"', '"Overlord Season 4 03"'],
    ['Mob Psycho 100 III', '"Mob Psycho 100 S03E03"', '"Mob Psycho 100 3rd Season 03"'],
  ])('reads a Roman numeral ending "%s" as its season', (title, code, spelling) => {
    const { query } = nyaaQuery({ title, episode: 3 });
    expect(query).toContain(code);
    expect(query).toContain(spelling);
  });

  it('keeps the most likely phrases of both main titles when a long title fills the search', () => {
    const { query } = nyaaQuery({
      title: 'Re:Zero kara Hajimeru Isekai Seikatsu 3rd Season',
      englishTitle: 'Re:ZERO -Starting Life in Another World- Season 3',
      episode: 5,
    });
    for (const phrase of [
      '"Re:Zero kara Hajimeru Isekai Seikatsu 3rd Season - 05"',
      '"Re:ZERO -Starting Life in Another World- Season 3 - 05"',
      '"Re:Zero kara Hajimeru Isekai Seikatsu - S03E05"',
      '"Re:ZERO -Starting Life in Another World- - S03E05"',
    ]) {
      expect(query).toContain(phrase);
    }
    // The less likely spellings, without punctuation or with other season words, don't fit
    expect(query).not.toContain('ReZERO');
    expect(query).not.toContain('Season 3 - S03E05');
  });

  it('ranks the "S3" season spelling with the title, as SubsPlease names seasons', () => {
    const phrases =
      nyaaQuery({
        title: 'Tensei shitara Slime Datta Ken 3rd Season',
        englishTitle: 'That Time I Got Reincarnated as a Slime Season 3',
        episode: 5,
      }).query.match(/"[^"]*"/g) ?? [];
    expect(phrases.slice(0, 2)).toEqual([
      '"Tensei shitara Slime Datta Ken 3rd Season - 05"',
      '"Tensei shitara Slime Datta Ken S3 - 05"',
    ]);
  });

  it('still fits short phrases after a long one that no longer does', () => {
    const { query } = nyaaQuery({
      title:
        'Ore dake Level Up na Ken: Isekai de Saikyou no Mahou Tsukai ni Natta Ore ga Mitsuketa Kagi no Himitsu to Sono Saki',
      englishTitle: 'Solo Leveling',
      episode: 5,
    });
    expect(query).toContain('"Solo Leveling - S01E05"');
    expect(query).toContain('"Solo Leveling S01E05"');
  });

  it('gives both main titles their dash form before either gets the rest', () => {
    const phrases =
      nyaaQuery({ title: 'Romaji Title', englishTitle: 'English Title', episode: 2 }).query.match(
        /"[^"]*"/g
      ) ?? [];
    expect(phrases.slice(0, 2)).toEqual(['"Romaji Title - 02"', '"English Title - 02"']);
  });

  it('gives the main titles every layout before other titles get any', () => {
    // Pokémon Horizons' titles on AniList, one per arc
    const { query } = nyaaQuery({
      title: 'Pocket Monsters (2023)',
      englishTitle: 'Pokémon Horizons: The Series',
      otherTitles: [
        'Pocket Monsters: Liko to Roy no Tabidachi (ポケットモンスター リコとロイの旅立ち)',
        'Pocket Monsters: Terapagos no Kagayaki (ポケットモンスター テラパゴスのかがやき)',
        'Pocket Monsters: Terastal Debut (ポケットモンスター テラスタルデビュー)',
        'Pocket Monsters: Rayquaza Rising (ポケットモンスター レックウザ ライジング)',
        'Pocket Monsters: Mega Voltage (ポケットモンスター メガボルテージ)',
        'Pokémon (2023)',
        'Pokémon Horizontes: A Série',
      ],
      episode: 152,
    });
    // As in "[Pokémon Fansub] Pokémon Horizons (Pocket Monsters 2023) - 152 VOSTFR (FR)"
    expect(query).toContain('"(Pocket Monsters 2023) - 152"');
    expect(query).toContain('"(Pokémon Horizons The Series) - 152"');
  });

  it('ranks the English title as a main title, not the first other one', () => {
    const otherTitles = Array.from({ length: 12 }, (_, i) => `Alternative Name ${i + 10}`);
    const withEnglish = nyaaQuery({
      title: 'Romaji',
      englishTitle: 'English',
      otherTitles,
      episode: 1,
    });
    expect(withEnglish.query).toContain('"(English) - 01"');
    // Without an English title, no other title gets a main title's place
    const withoutEnglish = nyaaQuery({ title: 'Romaji', otherTitles, episode: 1 }).query;
    expect(withoutEnglish).not.toContain('"(Alternative Name 10) - 01"');
  });

  it('also spells a title with a Japanese part in brackets without punctuation', () => {
    const { query } = nyaaQuery({
      title: 'Pocket Monsters (2023)',
      otherTitles: ['Pocket Monsters: Mega Voltage (ポケットモンスター メガボルテージ)'],
      episode: 5,
    });
    expect(query).toContain('"Pocket Monsters Mega Voltage 05"');
  });

  it('puts accents in one piece, as release names have them', () => {
    const { query } = nyaaQuery({ title: 'Pokémon (2023)'.normalize('NFD'), episode: 5 });
    expect(query).toContain('"Pokémon (2023) 05"');
  });

  it('falls back to the title words and episode when no title fits a phrase', () => {
    expect(nyaaQuery({ title: '薬屋のひとりごと', episode: 5 }).query).toBe(
      '薬屋のひとりごと 05 -batch'
    );
    // Without search operators, so "-ひとり" doesn't exclude a word and "|" doesn't mean "or"
    expect(nyaaQuery({ title: '薬屋 -ひとり|ごと', episode: 5 }).query).toBe(
      '薬屋 ひとり ごと 05 -batch'
    );
  });

  it('keeps the Latin part of a title with a Japanese part in brackets', () => {
    const { query } = nyaaQuery({
      title: 'Pocket Monsters (2023)',
      otherTitles: ['Pocket Monsters: Mega Voltage (ポケットモンスター メガボルテージ)'],
      episode: 5,
    });
    expect(query).toContain('"Pocket Monsters: Mega Voltage - 05"');
    expect(query).not.toContain('メガ');
  });

  it('leaves a larger number in the name', () => {
    const { query } = nyaaQuery({ title: 'Mob Psycho 100', episode: 5 });
    expect(query).toContain('"Mob Psycho 100 S01E05"');
    expect(query).not.toContain('S100');
  });

  it('keeps the search short, the main title first, so nyaa.si answers in time', () => {
    const otherTitles = Array.from({ length: 30 }, (_, i) => `Alternative Name ${i + 10}`);
    const { query } = nyaaQuery({ title: 'Main Title', otherTitles, episode: 1 });
    const phrases = query.match(/"[^"]*"/g) ?? [];
    // Measured as it's sent in the link, where quotes and "|" take several characters each
    const encoded = new URLSearchParams([['q', phrases.join('|')]]).toString().length - 2;
    expect(encoded).toBeLessThanOrEqual(600);
    expect(phrases[0]).toBe('"Main Title - 01"');
  });

  it('keeps one phrase even for a title longer than the whole budget', () => {
    const title = 'A Very Long Title '.repeat(40).trim();
    const phrases = nyaaQuery({ title, episode: 1 }).query.match(/"[^"]*"/g) ?? [];
    expect(phrases).toEqual([`"${title} - 01"`]);
  });

  it('keeps the dash release names put between the title and the episode', () => {
    // As in "[CicakRumah] Koupen-chan - S01E78 (コウペンちゃん) [AMZN.WEB-DL 1080P …]"
    expect(nyaaQuery({ title: 'Koupen-chan', episode: 78 }).query).toContain(
      '"Koupen-chan - S01E78"'
    );
  });

  it('spells a season the ways release groups write it', () => {
    const { query } = nyaaQuery({ title: 'Shangri-La Frontier 2nd Season', episode: 12 });
    for (const phrase of [
      '"Shangri-La Frontier 2nd Season 12"',
      '"Shangri-La Frontier S2 12"',
      '"Shangri-La Frontier Season 2 12"',
      '"Shangri-La Frontier S02E12"',
    ]) {
      expect(query).toContain(phrase);
    }
    // Never the bare title, which would also match season 1's episode 12
    expect(query).not.toContain('"Shangri-La Frontier 12"');
  });

  it.each([
    ['Title Season 3', 'Title 3rd Season'],
    ['Title S4', 'Title Season 4'],
    ['Title 11th Season', 'Title S11'],
  ])('reads the season from "%s"', (title, otherSpelling) => {
    expect(nyaaQuery({ title, episode: 1 }).query).toContain(`"${otherSpelling} 01"`);
  });

  it('also tries the English and alternative titles, skipping non-Latin ones', () => {
    const { query } = nyaaQuery({
      title: 'Kusuriya no Hitorigoto',
      englishTitle: 'The Apothecary Diaries',
      otherTitles: ['薬屋のひとりごと'],
      episode: 3,
    });
    expect(query).toContain('"Kusuriya no Hitorigoto 03"');
    expect(query).toContain('"The Apothecary Diaries 03"');
    expect(query).not.toContain('薬屋');
  });

  it('also spells titles without punctuation, as release names often do', () => {
    const { query } = nyaaQuery({ title: 'Dr. Stone: Science Future', episode: 2 });
    expect(query).toContain('"Dr Stone Science Future 02"');
    expect(query).toContain('"Dr. Stone: Science Future 02"');
  });

  it('also looks for a title in brackets after another one, without its own brackets', () => {
    const { query } = nyaaQuery({
      title: 'Pocket Monsters (2023)',
      englishTitle: 'Pokémon Horizons: The Series',
      episode: 152,
    });
    // As in "[Pokémon Fansub] Pokémon Horizons (Pocket Monsters 2023) - 152 VOSTFR (FR)"
    expect(query).toContain('"(Pocket Monsters 2023) - 152"');
    // Brackets are part of nyaa.si's words, so a title's own can't go inside another pair
    expect(query).not.toContain('"(Pocket Monsters (2023)) - 152"');
  });

  it('also spells titles without apostrophes', () => {
    const { query } = nyaaQuery({
      title: 'Kanojo no Tomodachi',
      englishTitle: "My Girlfriend's Friend",
      episode: 3,
    });
    // As in "My Girlfriends Friend S01E03 … (VOSTFR, Multi Subs, Kanojo no Tomodachi)"
    expect(query).toContain('"My Girlfriends Friend S01E03"');
    expect(query).toContain(`"My Girlfriend's Friend S01E03"`);
  });

  it('lists each spelling once, ignoring case', () => {
    const { query } = nyaaQuery({
      title: 'Natsu to Hako',
      otherTitles: ['NATSU TO HAKO'],
      episode: 1,
    });
    expect(query.match(/natsu to hako 01"/gi)).toHaveLength(1);
  });

  it('keeps quotes in a title from ending the phrase early', () => {
    const { query } = nyaaQuery({ title: 'Megami no "Café" Terrace', episode: 2 });
    expect(query).toContain('"Megami no Café Terrace 02"');
  });

  it('writes episodes past 99 in full', () => {
    expect(nyaaQuery({ title: 'One Piece', episode: 1100 }).query).toContain('"One Piece 1100"');
  });

  it.each([
    ['any', 'any', '1_0', ''],
    ['any', 'subbed', '1_0', '-dub -dubbed -vf'],
    ['any', 'dubbed', '1_0', '(dub|dubbed|(dual audio)|vf|multi)'],
    ['any', 'dual-audio', '1_0', '((dual audio)|multi)'],
    ['english', 'any', '1_2', ''],
    ['english', 'subbed', '1_2', '-dub -dubbed'],
    ['english', 'dubbed', '1_2', '(dub|dubbed|(dual audio))'],
    ['english', 'dual-audio', '1_2', '(dual audio)'],
    ['french', 'any', '1_3', '(vostfr|vf|vff|french|multi)'],
    ['french', 'subbed', '1_3', 'vostfr'],
    ['french', 'dubbed', '1_3', '(vf|vff|multi) -vostfr'],
    ['french', 'dual-audio', '1_3', 'multi'],
  ] as const)('looks for %s %s releases', (language, version, category, terms) => {
    const result = nyaaQuery({ title: 'Show', episode: 1, language, version });
    expect(result.category).toBe(category);
    expect(result.query).toBe([SHOW_PHRASES, terms, '-batch'].filter(Boolean).join(' '));
  });

  it('covers every combination of the settings', () => {
    for (const language of DOWNLOAD_LANGUAGES) {
      for (const version of DOWNLOAD_VERSIONS) {
        const { query } = nyaaQuery({ title: 'Show', episode: 1, language, version });
        expect(query.startsWith(SHOW_PHRASES)).toBe(true);
      }
    }
  });
});

describe('nyaaSearchUrl', () => {
  it('opens the search on nyaa.si, with only the category and the query', () => {
    const url = new URL(
      nyaaSearchUrl({ title: 'Show & Friends', episode: 1, language: 'english', version: 'subbed' })
    );
    expect(url.origin).toBe('https://nyaa.si');
    expect(Object.fromEntries(url.searchParams)).toEqual({
      c: '1_2',
      q: '("Show & Friends - 01"|"Show & Friends 01"|"Show & Friends - S01E01"|"Show & Friends S01E01"|"(Show & Friends) - 01") -dub -dubbed -batch',
    });
  });
});

describe('adult anime', () => {
  it('searches sukebei.nyaa.si', () => {
    expect(nyaaSite(true)).toBe('sukebei.nyaa.si');
    expect(nyaaSite(false)).toBe('nyaa.si');
    expect(new URL(nyaaSearchUrl({ title: 'Show', episode: 1, adult: true })).origin).toBe(
      'https://sukebei.nyaa.si'
    );
  });

  it.each([
    ['any', 'any', ''],
    ['english', 'any', '(english|eng)'],
    ['english', 'dubbed', '(english|eng) (dub|dubbed|(dual audio))'],
    ['french', 'subbed', 'vostfr'],
  ] as const)(
    'looks in its Anime category, telling %s %s releases apart by their tags',
    (language, version, terms) => {
      const result = nyaaQuery({ title: 'Show', episode: 1, language, version, adult: true });
      expect(result.category).toBe('1_1');
      expect(result.query).toBe([SHOW_PHRASES, terms, '-batch'].filter(Boolean).join(' '));
    }
  );
});
