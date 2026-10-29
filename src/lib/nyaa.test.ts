import { describe, expect, it } from 'vitest';

import {
  matchesPhrase,
  wordsInclude,
  namesEpisode,
  nyaaQueryPlan,
  packIncludes,
  nyaaQuery,
  nyaaQueryLength,
  NYAA_MAX_QUERY_LENGTH,
  nyaaNarrowing,
  nyaaSearchUrl,
  nyaaSite,
} from '#lib/nyaa.js';
import { DOWNLOAD_LANGUAGES, DOWNLOAD_VERSIONS } from '#lib/types/preferences.js';

// The phrases of both the first query and the broader one tried when it finds nothing
const allQueries = (search: Parameters<typeof nyaaQuery>[0]) => {
  const { query, broader } = nyaaQueryPlan(search);
  return { query: [query, broader].filter(Boolean).join(' | ') };
};

// Every search for episode 1 of "Show" starts with these phrases
const SHOW_PHRASES = '("Show - 01"|"Show S01E01"|"Show - S01E01"|"(Show) - 01"|"Show 01")';

describe('nyaaQuery', () => {
  it('looks for the title followed right away by the episode, the most common layouts first', () => {
    expect(nyaaQuery({ title: 'Natsu to Hako', episode: 5 }).query).toBe(
      '("Natsu to Hako - 05"|"Natsu to Hako S01E05"|"Natsu to Hako - S01E05"|"(Natsu to Hako) - 05"|"Natsu to Hako 05") -batch'
    );
  });

  it('reads a number from 2 to 9 ending the title as its season', () => {
    const { query } = allQueries({ title: 'Isekai Quartet 3', episode: 5 });
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
    const { query } = allQueries({ title: 'Kaiju No. 8', episode: 5 });
    expect(query).toContain('"Kaiju No. 8 S01E05"');
    expect(query).toContain('"Kaiju No. - S08E05"');
  });

  it.each([
    ['Overlord IV', '"Overlord S04E03"', '"Overlord Season 4 03"'],
    ['Mob Psycho 100 III', '"Mob Psycho 100 S03E03"', '"Mob Psycho 100 3rd Season 03"'],
  ])('reads a Roman numeral ending "%s" as its season', (title, code, spelling) => {
    const { query } = allQueries({ title, episode: 3 });
    expect(query).toContain(code);
    expect(query).toContain(spelling);
  });

  it('keeps the most likely phrases of both main titles when a long title fills the search', () => {
    const { query } = allQueries({
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
    const { query } = allQueries({
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
    const { query } = allQueries({
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
    expect(query).toContain('"(Pokémon Horizons: The Series) - 152"');
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
    const { query } = allQueries({
      title: 'Pocket Monsters (2023)',
      otherTitles: ['Pocket Monsters: Mega Voltage (ポケットモンスター メガボルテージ)'],
      episode: 5,
    });
    expect(query).toContain('"Pocket Monsters Mega Voltage 05"');
  });

  it('puts accents in one piece, as release names have them', () => {
    const { query } = nyaaQuery({ title: 'Pokémon (2023)'.normalize('NFD'), episode: 5 });
    expect(query).toContain('"Pokémon (2023) - 05"');
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
    expect(encoded).toBeLessThanOrEqual(NYAA_MAX_QUERY_LENGTH);
    expect(nyaaQueryLength(query)).toBeLessThanOrEqual(NYAA_MAX_QUERY_LENGTH);
    expect(phrases[0]).toBe('"Main Title - 01"');
  });

  it('keeps even an oversized title within the complete query budget', () => {
    const title = 'A Very Long Title '.repeat(40).trim();
    const { query } = nyaaQuery({ title, episode: 1, language: 'french', version: 'dubbed' });
    expect(nyaaQueryLength(query)).toBeLessThanOrEqual(NYAA_MAX_QUERY_LENGTH);
    expect(query).toContain('A Very Long Title');
    expect(query).toContain('01');
    expect(query).toContain('(vf|vff|multi) -batch');
  });

  it('keeps the dash release names put between the title and the episode', () => {
    // As in "[CicakRumah] Koupen-chan - S01E78 (コウペンちゃん) [AMZN.WEB-DL 1080P …]"
    expect(nyaaQuery({ title: 'Koupen-chan', episode: 78 }).query).toContain(
      '"Koupen-chan - S01E78"'
    );
  });

  it('spells a season the ways release groups write it', () => {
    const { query } = allQueries({ title: 'Shangri-La Frontier 2nd Season', episode: 12 });
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
    const { query } = allQueries({
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
    const { query } = allQueries({
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
    ['any', 'dubbed', '1_0', '(dub|dubbed|(dual audio)|(multi audio)|vf)'],
    ['any', 'dual-audio', '1_0', '((dual audio)|(multi audio)|(multi vf))'],
    ['english', 'any', '1_2', ''],
    ['english', 'subbed', '1_2', '-dub -dubbed'],
    ['english', 'dubbed', '1_2', '(dub|dubbed|(dual audio)|(multi audio))'],
    ['english', 'dual-audio', '1_2', '((dual audio)|(multi audio))'],
    ['french', 'any', '1_3', '(vostfr|vf|vff|french|multi)'],
    ['french', 'subbed', '1_3', 'vostfr'],
    ['french', 'dubbed', '1_3', '(vf|vff|multi)'],
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
  it('uses custom search terms verbatim while preserving the category and safe destination', () => {
    const query = '  "Other Anime" 12 1080p -batch &c=0_0 #test  ';
    const url = new URL(
      nyaaSearchUrl({ title: 'Show', episode: 1, language: 'english', version: 'dubbed', query })
    );
    expect(url.origin).toBe('https://nyaa.si');
    expect(url.searchParams.get('c')).toBe('1_2');
    expect(url.searchParams.get('q')).toBe(query.trim());
    expect(url.hash).toBe('');
  });
  it('opens the search on nyaa.si, with only the category and the query', () => {
    const url = new URL(
      nyaaSearchUrl({ title: 'Show & Friends', episode: 1, language: 'english', version: 'subbed' })
    );
    expect(url.origin).toBe('https://nyaa.si');
    expect(Object.fromEntries(url.searchParams)).toEqual({
      c: '1_2',
      q: '("Show & Friends - 01"|"Show & Friends S01E01"|"Show & Friends - S01E01"|"(Show & Friends) - 01"|"Show & Friends 01") -dub -dubbed -batch',
    });
  });
});

describe('bounded search plans', () => {
  const phrases = (query = ''): string[] => query.match(/"[^"]*"/g) ?? [];

  it('tries omitted alternate names in the broader query without repeating the first phrases', () => {
    const plan = nyaaQueryPlan({
      title: 'Romaji Title',
      englishTitle: 'English Title',
      otherTitles: ['An Alternate Name', 'A Second Name'],
      episode: 5,
    });
    expect(plan.broader).toContain('"An Alternate Name - 05"');
    const first = phrases(plan.query);
    expect(phrases(plan.broader).every((phrase) => !first.includes(phrase))).toBe(true);
  });

  it('retries a slow search with only its most likely phrases and the same filters', () => {
    const plan = nyaaQueryPlan({
      title: 'Romaji Title',
      englishTitle: 'English Title',
      episode: 5,
      language: 'french',
      version: 'subbed',
    });
    expect(plan.lighter).toBe(`(${phrases(plan.query).slice(0, 3).join('|')}) vostfr -batch`);
    // A search that is already that light has nothing left to take out
    expect(nyaaQueryPlan({ title: 'Show', episode: 5, query: 'Show 05' }).lighter).toBeUndefined();
    expect(nyaaQueryPlan({ title: '薬屋のひとりごと', episode: 5 }).lighter).toBeUndefined();
  });

  it('looks for the episode codes of web releases before the numbers few releases write', () => {
    // As in "Frieren Beyond Journeys End S02E09 … 1080p CR WEB-DL MULTi AAC2.0 H 264-VARYG"
    const first = phrases(
      nyaaQueryPlan({
        title: 'Sousou no Frieren',
        englishTitle: "Frieren: Beyond Journey's End",
        episode: 3,
      }).query
    );
    expect(first).toContain('"Frieren: Beyond Journey\'s End S01E03"');
    expect(first).toContain('"Frieren Beyond Journeys End S01E03"');
  });

  it('leaves out the square brackets a title is written in, as release names do', () => {
    // As in "[Erai-raws] Oshi no Ko 2nd Season - 03 [1080p]"
    const { query } = nyaaQueryPlan({ title: '[Oshi no Ko] 2nd Season', episode: 3 });
    expect(phrases(query)[0]).toBe('"Oshi no Ko 2nd Season - 03"');
    expect(query).not.toContain('[');
  });

  it('leaves out dashes around words without punctuation, but not the ones inside a word', () => {
    // As in "[ToonsHub] ReZERO Starting Life in Another World S04E17 1080p AMZN WEB-DL"
    const { query } = allQueries({
      title: 'Re:Zero kara Hajimeru Isekai Seikatsu 4th Season',
      englishTitle: 'Re:ZERO -Starting Life in Another World- Season 4',
      episode: 17,
    });
    expect(query).toContain('"ReZERO Starting Life in Another World S04E17"');
    expect(query).not.toContain('ReZERO -Starting');
    // As in "Re ZERO Starting Life in Another World S04E12 MULTi 1080p CR WEB-DL … Tsundere-Raws"
    expect(query).toContain('"Re ZERO Starting Life in Another World S04E17"');
    expect(nyaaQuery({ title: 'Shangri-La Frontier', episode: 2 }).query).toContain(
      '"Shangri-La Frontier - 02"'
    );
  });

  it('also spells a dash inside a word as a space, keeping the rest of the title', () => {
    // As in "[Erai-raws] Bleach: Sennen Kessen Hen - Kashin Tan - 10 [1080p DSNP WEB-DL …]"
    const { query } = nyaaQueryPlan({
      title: 'BLEACH: Sennen Kessen-hen - Kashin-tan',
      englishTitle: 'BLEACH: Thousand-Year Blood War - The Calamity',
      episode: 10,
    });
    expect(query).toContain('"BLEACH: Sennen Kessen hen - Kashin tan - 10"');
  });

  it("also numbers the episode on from the series' first part, with the main titles' numbers", () => {
    // As in "[Half-Baked] … | Kusuriya no Hitorigoto - 52 | The Apothecary Diaries Season 3 - 04"
    const search = {
      title: 'Kusuriya no Hitorigoto 3rd Season',
      englishTitle: 'The Apothecary Diaries Season 3',
      episode: 4,
    };
    const first = phrases(
      nyaaQueryPlan(search, {
        arc: { offset: 48, title: 'Kusuriya no Hitorigoto', season: 3 },
        related: [],
      }).query
    );
    expect(first.indexOf('"Kusuriya no Hitorigoto - 52"')).toBeGreaterThan(-1);
    expect(first.indexOf('"Kusuriya no Hitorigoto - 52"')).toBeLessThan(
      first.indexOf('"Kusuriya no Hitorigoto S03E04"')
    );
    expect(nyaaQueryPlan(search).query).not.toContain('52');
  });

  it("also searches the first part's words with the series' number, as no phrase says S17E50", () => {
    const search = {
      title: 'BLEACH: Sennen Kessen-hen - Kashin-tan',
      episode: 10,
      language: 'french',
      version: 'subbed',
    } as const;
    expect(
      nyaaQueryPlan(search, {
        arc: { offset: 40, title: 'BLEACH: Sennen Kessen-hen', season: 4 },
        related: [],
      }).seriesNumber
    ).toEqual({
      query: '(BLEACH Sennen Kessen hen 50) vostfr -batch',
      episode: 50,
    });
    expect(nyaaQueryPlan(search).seriesNumber).toBeUndefined();
  });

  it.each([
    ['Bleach S17E50 SUBFRENCH 720p DSNP WEB-DL AAC2.0 H.264-Tsundere-Raws', true],
    ['Bleach.S17E50.FiNAL.VOSTFR.1080p.WEBRiP.x265-KAF', true],
    ['[SubsPlease] Bleach - Sennen Kessen Hen - 50 (1080p) [22C2464E].mkv', true],
    ['[ANi] Bleach Sennen Kessenhen - 50 [1080P][Baha][WEB-DL]', true],
    ['[Knight-Subs] Bleach Thousand-Year Blood War - E50 - Death & Strawberry', true],
    ['[DKB] Bleach - 50v2 [1080p]', true],
    ['[Erai-raws] Bleach: Sennen Kessen Hen - Kashin Tan - 03 [1080p][50F3DC8F]', false],
    ['[Erai-raws] Bleach: Sennen Kessen Hen - Kashin Tan - 06 [1080p][EB8FF50C]', false],
    ['[AnoZu] Bleach S17E41-E50 1080p CR WEB-DL', false],
    ['Bleach - 50.5 Recap', false],
    ['Bleach - 150', false],
  ])('tells whether "%s" names episode 50', (name, names) => {
    expect(namesEpisode(name, 50)).toBe(names);
  });

  describe('packs', () => {
    const duelMonsters = {
      title: 'Yu☆Gi☆Oh! Duel Monsters',
      englishTitle: 'Yu-Gi-Oh!',
      // Its synonyms on AniList
      otherTitles: [
        'Yugioh',
        'Yu-Gi-Oh!: Duel Monsters',
        'Yugioh: Duel Monsters',
        '遊戲王－怪獸之決鬥',
      ],
      episode: 46,
    };
    const related = [
      'Yu☆Gi☆Oh! Duel Monsters GX',
      "Yu☆Gi☆Oh! 5D's",
      'Yu☆Gi☆Oh! Duel Monsters ALEX',
    ];

    it("searches the titles without the episode, leaving out the series' other entries", () => {
      const { packs } = nyaaQueryPlan(duelMonsters, { arc: null, related });
      expect(packs).toMatchObject({ episode: 46, season: 1 });
      // As in "[Yu-Gi-Oh! Fansubs] Yu-Gi-Oh! Duel Monsters - Episodes 001 à 049 DVD-JAP VOSTFR"
      expect(packs!.query).toContain('"Yu-Gi-Oh! Duel Monsters"');
      expect(packs!.query).toMatch(/\) -gx -alex$/);
      // Not the franchise's name, which would find every Yu-Gi-Oh! series
      expect(packs!.query).not.toContain('"Yu-Gi-Oh!"');
      expect(packs!.query).not.toContain('"Yugioh"');
      expect(packs!.query).not.toContain('batch');
    });

    it('also spells a symbol between words as a dash', () => {
      expect(allQueries(duelMonsters).query).toContain('"Yu-Gi-Oh! Duel Monsters - 46"');
    });

    it('keeps a symbol ending the title, which tells it from another series', () => {
      const plan = nyaaQueryPlan({ title: 'Gintama°', episode: 5 });
      expect([plan.query, plan.broader].join(' ')).not.toContain('"Gintama - 05"');
      expect(plan.packs!.query).not.toContain('"Gintama"');
    });

    it('keeps a group of phrases only when something follows it, as nyaa.si needs', () => {
      expect(nyaaQueryPlan({ title: 'Show', episode: 1 }).packs!.query).toBe('"Show"');
      expect(
        nyaaQueryPlan({ title: 'Show', episode: 1, language: 'french', version: 'subbed' }).packs!
          .query
      ).toBe('("Show") vostfr');
    });

    it.each([
      ['[DBD-Raws][游戏王 怪兽之决斗/Yu-Gi-Oh! Duel Monsters][001-224TV全集+SP][1080P]', true],
      ['[Skymoon-Raws] Yu-Gi-Oh! Duel Monsters 20th Anniversary - 001~224 [WEB-DL]', true],
      ['[Yu-Gi-Oh! Fansubs] Yu-Gi-Oh! Duel Monsters - Episodes 001 à 049 DVD-JAP VOSTFR', true],
      ['[Refrain] Yu☆Gi☆Oh! Duel Monsters (01-49) VF [540p]', true],
      ['Yu-Gi-Oh! Duel Monsters [Intégrale VOSTFR ADN - Remux DVDrip JP]', true],
      ['[Yu-Gi-Oh! Fansubs] Yu-Gi-Oh! Duel Monsters - Episodes 050 à 097 DVD-JAP VOSTFR', false],
      // Its own season's episodes 1 to 48
      ['[Refrain] Yu☆Gi☆Oh! Duel Monsters S2 (01-48) VF [540p]', false],
      ['Yu-Gi-Oh! Duel Monsters S01 [DVDrip JP MULTI - VF NC & VOSTFR ADN]', false],
      ['Yu-Gi-Oh! Duel Monsters (2000-2004) x264-Group', false],
      // Years aren't episodes, so the pack is still complete
      ['Yu-Gi-Oh! Duel Monsters (2000-2004) Complete [DVD]', true],
      // Episode 0 is in, but not 46
      ['[Group] Yu-Gi-Oh! Duel Monsters (00-12) [1080p]', false],
    ])('tells whether "%s" includes episode 46', (name, includes) => {
      expect(packIncludes(name, { query: '', episode: 46, season: 1 })).toBe(includes);
    });

    it('reads the range after a number ending the title', () => {
      const packs = { query: '', episode: 5, season: 1 };
      expect(packIncludes('[Group] Kaiju No. 8 - 01-12 [1080p]', packs)).toBe(true);
      expect(packIncludes('Mob Psycho 100 - 01-12', packs)).toBe(true);
    });

    it('leaves out other titles of a single word, and packs without one of the titles', () => {
      // "SBR" alone finds unrelated releases, as "[DVD_ISO] Duel Masters - Vol. 1-5"
      const { packs } = nyaaQueryPlan({
        title: 'JoJo no Kimyou na Bouken: Steel Ball Run - 2nd & 3rd STAGE',
        otherTitles: ['SBR', "JoJo's Bizarre Adventure: Part 7"],
        episode: 5,
      });
      expect(packs!.query).not.toContain('"SBR"');
      expect(packs!.query).toContain(`"JoJo's Bizarre Adventure: Part 7"`);
      expect(packIncludes('[DVD_ISO] Duel Masters - Vol. 1-5', packs!)).toBe(false);
      expect(
        packIncludes(
          '[Group] JoJo no Kimyou na Bouken: Steel Ball Run - 2nd & 3rd STAGE (01-11)',
          packs!
        )
      ).toBe(true);
    });

    it("takes a pack numbered on from the series' first part", () => {
      const packs = { query: '', episode: 10, season: 1, seriesEpisode: 50 };
      expect(packIncludes('Bleach Sennen Kessen-hen 41-50 [1080p]', packs)).toBe(true);
      expect(packIncludes('Bleach Sennen Kessen-hen 11-26 [1080p]', packs)).toBe(false);
    });
  });

  it("searches each title's words without its season, with the episode", () => {
    const { words } = nyaaQueryPlan({
      title: 'Sousou no Frieren 2nd Season',
      englishTitle: "Frieren: Beyond Journey's End Season 2",
      episode: 9,
      language: 'french',
      version: 'subbed',
    });
    expect(words!.query).toBe(
      '((Sousou no Frieren 09)|(Frieren Beyond Journey s End 09)) vostfr -batch'
    );
    // Every phrase, beyond the ten a query holds
    expect(words!.phrases.length).toBeGreaterThan(10);
    expect(words!.phrases).toContain('"Sousou no Frieren S2 - 09"');
  });

  it.each([
    ['[SubsPlease] Sousou no Frieren S2 - 09 (1080p) [A1B2C3D4].mkv', true],
    ['FRIEREN BEYOND JOURNEYS END S02E09 1080p WEB-DL', true],
    // The first season's ninth episode
    ['[SubsPlease] Sousou no Frieren - 09 (1080p)', false],
    ['[SubsPlease] Sousou no Frieren S2 - 19 (1080p) [09ABCDEF].mkv', false],
  ])('tells whether "%s" has one of the phrases', (name, matches) => {
    expect(
      matchesPhrase(name, ['"Sousou no Frieren S2 - 09"', '"Frieren Beyond Journeys End S02E09"'])
    ).toBe(matches);
  });

  it.each([
    // Spacing, accents and punctuation written differently
    ['[Erai-raws] Yowaki Max Reijou nanoni - 04 [1080p]', '"Yowaki MAX Reijou Nano ni - 04"', true],
    ['Cunning Fiance S01E04 SUBFRENCH 1080p', '"Cunning Fiancé S01E04"', true],
    ['Tougen.Anki.S02E04.VOSTFR.1080p.WEBRiP.x265-KAF', '"Tougen Anki S02E04"', true],
    ['[Group] Show - 05v2 [1080p]', '"Show - 05"', true],
    // But never another number, a longer word or another season
    ['[Group] Show - 050 [1080p]', '"Show - 05"', false],
    ['[Group] Show - 0.5 Recap', '"Show - 05"', false],
    ['[Group] Shows - 05', '"Show - 05"', false],
    ['[Group] Show 2nd Season - 05', '"Show - 05"', false],
  ])('matches "%s" loosely with %s: %s', (name, phrase, matches) => {
    expect(matchesPhrase(name, [phrase])).toBe(matches);
  });

  it('never takes a second season named with a number for an episode of the first', () => {
    // "Isekai Quartet 2 - 05" is the second season's fifth episode, not the first season's second
    const plan = nyaaQueryPlan({ title: 'Isekai Quartet', episode: 2 });
    expect([plan.query, plan.broader].join(' ')).not.toContain('"Isekai Quartet 2"');
    expect(wordsInclude('[Group] Isekai Quartet 2 - 05 [1080p]', plan.words!)).toBe(false);
    expect(wordsInclude('[Group] Isekai Quartet - 02 [1080p]', plan.words!)).toBe(true);
    const { packs } = nyaaQueryPlan({ title: 'Isekai Quartet', episode: 5 });
    expect(packIncludes('[Group] Isekai Quartet 2 (01-12)', packs!)).toBe(false);
    expect(packIncludes('[Group] Isekai Quartet (01-12)', packs!)).toBe(true);
  });

  it('spells a middle dot between words as a space', () => {
    // As in "[Erai-raws] Tougen Anki: Nikko Kegon no Taki-hen - 04 [1080p CR WEBRip HEVC AAC]"
    expect(
      nyaaQuery({ title: 'Tougen Anki: Nikko・Kegon no Taki-hen', episode: 4 }).query
    ).toContain('"Tougen Anki: Nikko Kegon no Taki-hen - 04"');
  });

  it("numbers the season with the series' first title, as web releases do", () => {
    // As in "[Judas] Tougen Anki - S02E04" and "[NanakoRaws] Tougen Anki S2 - 04"
    const { words } = nyaaQueryPlan(
      { title: 'Tougen Anki: Nikko・Kegon no Taki-hen', episode: 4 },
      { arc: { offset: 24, title: 'Tougen Anki', season: 2 }, related: [] }
    );
    expect(words!.query).toContain('(Tougen Anki 04)');
    for (const phrase of [
      '"Tougen Anki S02E04"',
      '"Tougen Anki - S02E04"',
      '"Tougen Anki S2 - 04"',
    ])
      expect(words!.phrases).toContain(phrase);
  });

  describe('on sukebei', () => {
    const series = { arc: null, related: [], native: '日本語タイトル' };
    const search = { title: 'Romaji Title', englishTitle: 'English Title', episode: 1 };

    it('also searches the native title, and the number as "#1" and "第1話" write it', () => {
      const { words } = nyaaQueryPlan({ ...search, adult: true }, series);
      expect(words!.query).toBe(
        '((Romaji Title 1)|(Romaji Title 01)|(日本語タイトル 1)|(日本語タイトル 01)|(English Title 1)|(English Title 01)) -batch'
      );
      expect(words!.loosely).toEqual({
        titles: ['Romaji Title', 'English Title', '日本語タイトル'],
        episode: 1,
      });
      // Not on nyaa.si, whose releases this was measured against
      const plain = nyaaQueryPlan(search, series).words!;
      expect(plain.query).toBe('((Romaji Title 01)|(English Title 01)) -batch');
      expect(plain.loosely).toBeUndefined();
    });

    it.each([
      ['[Group] 日本語タイトル ＃1 [1080p]', true],
      ['[Group] 日本語タイトル第1話', true],
      ['[Group] Romaji Title #1 (720p)', true],
      ['[Group] Romaji Title [01][1080p]', true],
      ['[Group] 日本語タイトル 上巻', true],
      ['[Group] 日本語タイトル ＃2', false],
      ['[Group] Romaji Title #12', false],
      ['[Group] 日本語タイトル 下巻', false],
      ['[Group] Other Show #1', false],
    ])('tells whether "%s" is episode 1', (name, includes) => {
      const { words } = nyaaQueryPlan({ ...search, adult: true }, series);
      expect(wordsInclude(name, words!)).toBe(includes);
    });
  });

  it('covers unpadded episode numbers, accents, and hyphen differences', () => {
    const queries = allQueries({ title: 'Pokémon-Adventure', episode: 5 }).query;
    expect(queries).toContain('"Pokemon-Adventure - 05"');
    expect(queries).toContain('"Pokémon Adventure - 05"');
    expect(allQueries({ title: 'Show', episode: 5 }).query).toContain('"Show - 5"');
  });

  it.each(['Very Long Title '.repeat(40), '薬'.repeat(500), '🌊'.repeat(250)])(
    'bounds pathological titles without losing preference or episode constraints',
    (title) => {
      for (const language of DOWNLOAD_LANGUAGES)
        for (const version of DOWNLOAD_VERSIONS) {
          const { query, lighter, broader } = nyaaQueryPlan({
            title,
            episode: 100000,
            language,
            version,
            otherTitles: ['Alternate'],
          });
          for (const each of [query, lighter, broader]) {
            if (each === undefined) continue;
            expect(nyaaQueryLength(each)).toBeLessThanOrEqual(NYAA_MAX_QUERY_LENGTH);
            expect(each).toContain('100000');
            expect(each).toContain('-batch');
            expect(phrases(each).length).toBeLessThanOrEqual(10);
          }
        }
    }
  );

  it('bounds the non-Latin and unbroken-title fallback even without any aliases', () => {
    for (const title of ['薬'.repeat(500), '🌊'.repeat(250), 'Long title '.repeat(50)]) {
      const { query } = nyaaQueryPlan({
        title,
        episode: 5,
        language: 'french',
        version: 'dual-audio',
      });
      expect(nyaaQueryLength(query)).toBeLessThanOrEqual(NYAA_MAX_QUERY_LENGTH);
      expect(query).toContain('05 multi -batch');
      expect(query).not.toMatch(/^[\s\d]+multi/);
    }
  });

  it('keeps custom queries verbatim and never generates alternatives for them', () => {
    expect(nyaaQueryPlan({ title: 'Show', episode: 5, query: ' "Other" 5 | Special ' })).toEqual({
      category: '1_0',
      query: '"Other" 5 | Special',
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
    ['english', 'dubbed', '(english|eng) (dub|dubbed|(dual audio)|(multi audio))'],
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

describe('nyaaNarrowing', () => {
  it.each([
    ['any', 'any', ''],
    ['any', 'subbed', 'non-dubbed'],
    ['english', 'subbed', 'English subbed'],
    ['any', 'dual-audio', 'dual-audio'],
    ['english', 'any', 'English'],
    ['french', 'dubbed', 'French dubbed'],
  ] as const)('names %s %s releases', (language, version, name) => {
    expect(nyaaNarrowing({ title: 'Show', episode: 1, language, version })).toBe(name);
  });

  it('names only the category for a custom search, which holds French with other languages', () => {
    const search = { title: 'Show', episode: 1, language: 'french', version: 'dubbed' } as const;
    expect(nyaaNarrowing({ ...search, query: 'Show 01' })).toBe('non-English');
    expect(nyaaNarrowing({ ...search, language: 'english', query: 'Show 01' })).toBe('English');
    expect(nyaaNarrowing({ ...search, query: 'Show 01', adult: true })).toBe('');
    expect(nyaaNarrowing({ ...search, adult: true })).toBe('French dubbed');
  });
});
