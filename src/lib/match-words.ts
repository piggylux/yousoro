import { formatScore, type ScoreFormat } from '#lib/score.js';
import type {
  MatchPick,
  ScoredAnime,
  ScoredByBoth,
  TasteMatch,
  TasteProfile,
} from '#lib/types/match.js';

/**
 * How to speak of the two people compared: by name, or as "you" to a viewer who is one of them.
 * The capitalized forms start a sentence; names keep their own case
 */
export function voiceFor(viewer: string | null | undefined) {
  const isViewer = (name: string) => viewer?.toLowerCase() === name.toLowerCase();
  return {
    isViewer,
    who: (name: string) => (isViewer(name) ? 'you' : name),
    Who: (name: string) => (isViewer(name) ? 'You' : name),
    whose: (name: string) => (isViewer(name) ? 'your' : `${name}'s`),
    Whose: (name: string) => (isViewer(name) ? 'Your' : `${name}'s`),
  };
}

export type Voice = ReturnType<typeof voiceFor>;

/** Names as one phrase: "Mika", "Mika and Sora", or "Mika, Sora and Ren" */
export function joinNames(names: string[]): string {
  return names.length > 1
    ? `${names.slice(0, -1).join(', ')} and ${names.at(-1)}`
    : (names[0] ?? '');
}

/** A piece of a sentence: words, or an anime's title, which is shown as one */
export type WordPart = { text: string; title?: true };

const title = (anime: ScoredAnime): WordPart => ({ text: anime.title, title: true });
// A score never breaks across lines in the middle of a sentence: "8 / 10"
const scoreOf = (score: number, format: ScoreFormat) =>
  formatScore(score, format).replaceAll(' ', '\u00a0');

/** A sentence from a template, its anime titles kept apart from its words */
function say(strings: TemplateStringsArray, ...values: (string | WordPart | WordPart[])[]) {
  const parts: WordPart[] = [];
  strings.forEach((text, index) => {
    if (text) parts.push({ text });
    const value = values[index];
    if (value === undefined) return;
    for (const part of [value].flat()) parts.push(typeof part === 'string' ? { text: part } : part);
  });
  return parts;
}

/**
 * Picks one of several wordings for a pair: the same every time for them, whichever of them comes
 * first, so a match and its link preview always read alike. Each choice in a match, its `slot`,
 * reads another base-3 digit of the pair's number, so wordings don't always come in the same sets
 */
const chooserFor =
  (a: { id: number }, b: { id: number }) =>
  <T>(options: T[], slot = 0) =>
    options[Math.floor((a.id + b.id) / 3 ** slot) % options.length];

/**
 * A joke, said the same to the two of them and about them, or as said to them and about them.
 * Each fits on one line of a match's link preview: 80 characters at most
 */
type Joke = string | [toThem: string, aboutThem: string];

/**
 * What a match's percent says, from the closest match down: a few words shown beside it and on
 * its link preview, jokes made to be shared, one of them for each pair, and the tone of its final
 * thought
 */
const TIERS: { min: number; label: string; tone: 'close' | 'mixed' | 'rivals'; jokes: Joke[] }[] = [
  {
    min: 95,
    label: 'Same brain cell',
    tone: 'close',
    jokes: [
      [
        "Are you two sure you're not one person with two accounts?",
        "Are these two sure they're not one person with two accounts?",
      ],
      'Two AniList accounts, one opinion. Statistically suspicious.',
      [
        'Even your hot takes match. This is getting a little spooky.',
        'Even their hot takes match. This is getting a little spooky.',
      ],
    ],
  },
  {
    min: 85,
    label: 'Kindred spirits',
    tone: 'close',
    jokes: [
      [
        'You two could swap watchlists and nobody would notice. Not even you.',
        'These two could swap watchlists and nobody would notice. Not even them.',
      ],
      'Same tastes, same tears, probably at the same episode.',
      [
        'Recommendations between you two come with a money-back guarantee.',
        'Recommendations between these two come with a money-back guarantee.',
      ],
    ],
  },
  {
    min: 70,
    label: 'Watch-party ready',
    tone: 'close',
    jokes: [
      'Certified watch-party material. Snacks are on whoever loses the next argument.',
      'Ready for a marathon together, as long as nobody skips the opening.',
      [
        "You'd agree on tonight's watch in under five minutes. Impressive.",
        "They'd agree on tonight's watch in under five minutes. Impressive.",
      ],
    ],
  },
  {
    min: 55,
    label: 'Couch compatible',
    tone: 'mixed',
    jokes: [
      'Agree enough to share a couch, disagree enough to fight over the remote.',
      'Not quite the main pairing, but the fandom ships it anyway.',
      [
        'Half your recommendations will land. The other half will start a debate.',
        'Half their recommendations will land. The other half will start a debate.',
      ],
    ],
  },
  {
    min: 40,
    label: 'Friendly rivals',
    tone: 'mixed',
    jokes: [
      [
        'Rivals who respect each other. Very shōnen of you.',
        'Rivals who respect each other. Very shōnen of them.',
      ],
      'One more disagreement and this becomes a tournament arc.',
      'Disagree loudly, then binge the same season anyway.',
    ],
  },
  {
    min: 25,
    label: 'Polar opposites',
    tone: 'rivals',
    jokes: [
      [
        'Your watchlists met once and agreed to stay polite.',
        'Their watchlists met once and agreed to stay polite.',
      ],
      [
        "You'd need a whole training arc to agree on a single show.",
        "They'd need a whole training arc to agree on a single show.",
      ],
      'Opposite tastes, which makes every recommendation a plot twist.',
    ],
  },
  {
    min: 0,
    label: 'Sworn rivals',
    tone: 'rivals',
    jokes: [
      [
        'Every great story needs a rival. You two found yours.',
        'Every great story needs a rival. These two found theirs.',
      ],
      [
        'If one of you loves it, the other has already dropped it.',
        'If one of them loves it, the other has already dropped it.',
      ],
      [
        'Enemies to friends is a classic arc. You two are still on episode one.',
        'Enemies to friends is a classic arc. These two are still on episode one.',
      ],
    ],
  },
];

const tierOf = (percent: number) => TIERS.find(({ min }) => percent >= min) ?? TIERS.at(-1)!;

/** A few words for a match's percent, shown beside it and on its link preview */
export function describeMatch(percent: number): string {
  return tierOf(percent).label;
}

/**
 * The joke for a match between `a` and `b`, made to be shared: said to the two of them when the
 * viewer is one of them, or about them otherwise
 */
export function matchComment(
  percent: number,
  a: { id: number },
  b: { id: number },
  toThem: boolean
): string {
  const joke = chooserFor(a, b)(tierOf(percent).jokes);
  return typeof joke === 'string' ? joke : joke[toThem ? 0 : 1];
}

/*
 * The words a franchise's anime share at the start of their titles, so a sentence doesn't name two
 * seasons of one show: "Steins;Gate", "Steins;Gate 0" and "Steins;Gate: Fuka Ryouiki no Déjà vu".
 * Two unrelated titles that start alike only make it name another anime instead
 */
const franchise = (anime: ScoredAnime) =>
  anime.title
    .toLowerCase()
    .split(/\s+/)[0]
    .replace(/[^\p{L}\p{N}]+$/u, '');
/** Two titles longer than this together are too much for one sentence: only the first is named */
const MAX_TITLES_LENGTH = 48;
/** Titles of later parts: "Season 2", "2nd Season", "Part 2", "II", "R2", "The Final", a movie or an OVA */
const LATER_PART =
  /\b(season|part|cour)\s*\d|\b\d+(st|nd|rd|th)\s+(season|stage)\b|\b(ii|iii|iv|r2)\b|\bfinal\b|\bmovie\b|\bova\b|\bspecials?\b|'$/i;

/** One or two anime both loved, from different shows, as one part of a sentence */
function lovedTitles(bothLoved: ScoredByBoth[]): { titles: WordPart[]; are: string } | null {
  const [loved, ...rest] = bothLoved.map(({ anime }) => anime);
  if (!loved) return null;
  const other = rest.find((anime) => franchise(anime) !== franchise(loved));
  return other && loved.title.length + other.title.length <= MAX_TITLES_LENGTH
    ? { titles: [title(loved), { text: ' and ' }, title(other)], are: 'are' }
    : { titles: [title(loved)], are: 'is' };
}

/**
 * The homework to set: an anime already on the plan list, as it's waited long enough, or else one
 * that isn't a later part, as nobody should start a show at its second season
 */
function homework(picks: MatchPick[]): MatchPick | undefined {
  return (
    picks.find(({ planned }) => planned) ??
    picks.find(({ anime }) => !LATER_PART.test(anime.title)) ??
    picks[0]
  );
}

/**
 * A few closing jokes on a match, from its own anime, at most three and in the score's tone: close
 * matches celebrate what both loved and tease their one disagreement, rivals lead with the fight
 * and concede their common ground, and all end with homework for the viewer. The wording varies
 * from one pair to the next, but a match always reads the same, so a shared link shows what was
 * shared
 */
export function finalThought(
  match: TasteMatch,
  a: TasteProfile,
  b: TasteProfile,
  voice: Voice
): WordPart[][] {
  const { who, Who, whose, Whose, isViewer } = voice;
  const choose = chooserFor(a, b);
  // The viewer first: "You and Alice"
  const [first, second] = isViewer(b.name) ? [b, a] : [a, b];
  const pair = `${who(first.name)} and ${second.name}`;
  const Pair = `${Who(first.name)} and ${second.name}`;
  const tone = match.percent === null ? 'unknown' : tierOf(match.percent).tone;

  const loved = lovedTitles(match.bothLoved);
  const agreement =
    loved &&
    choose(
      [
        say`${loved.titles} ${loved.are} the load-bearing anime of this friendship.`,
        say`${Pair} agree ${loved.titles} ${loved.are} peak. Nobody tell the comment section.`,
        say`On ${loved.titles}, ${pair} could finish each other's sentences, spoilers included.`,
      ],
      1
    );
  // Rivals' common ground is the exception, so it's a single anime
  const [peace] = match.bothLoved;
  const concession =
    peace &&
    choose(
      [
        say`At least ${pair} both love ${title(peace.anime)}. It's a start.`,
        say`The one thing keeping the peace: ${title(peace.anime)}, loved on both sides.`,
        say`Peace talks can start with ${title(peace.anime)}, which ${pair} both love.`,
      ],
      1
    );

  const [split] = match.disagreements;
  const scoreA = split && scoreOf(split.a, a.scoreFormat);
  const scoreB = split && scoreOf(split.b, b.scoreFormat);
  const fight =
    split &&
    choose(
      [
        say`Never bring up ${title(split.anime)} at dinner: ${who(a.name)} gave it ${scoreA}, ${who(b.name)} gave it ${scoreB}, and someone is wrong.`,
        say`${title(split.anime)} is where the gloves come off, ${scoreA} from ${who(a.name)} against ${scoreB} from ${who(b.name)}.`,
        say`${title(split.anime)}: ${scoreA} from ${who(a.name)}, ${scoreB} from ${who(b.name)}. Settle it with a rewatch, or a duel.`,
      ],
      2
    );
  // A close match's disagreement is the exception, so it's only teased
  const crack =
    split &&
    choose(
      [
        say`The only crack in the armor: ${title(split.anime)}, ${scoreA} from ${who(a.name)} against ${scoreB} from ${who(b.name)}.`,
        say`Just never bring up ${title(split.anime)}: ${who(a.name)} gave it ${scoreA}, ${who(b.name)} gave it ${scoreB}.`,
        say`Mostly peaceful, apart from ${title(split.anime)}: ${scoreA} from ${who(a.name)}, ${scoreB} from ${who(b.name)}.`,
      ],
      2
    );

  // The result above already says how many anime they share, unless it's none
  const nudge =
    match.inCommon === 0
      ? say`Zero anime in common. Either a beautiful friendship is about to begin, or a very long argument.`
      : say`Not enough shared scores to call it yet. Go score some anime, the fate of this match depends on it.`;

  // Homework for the viewer first, or for whoever was compared with the list's owner
  const sides = [
    { to: b, from: a, pick: homework(match.picksForB) },
    { to: a, from: b, pick: homework(match.picksForA) },
  ];
  const next = (isViewer(a.name) ? sides.reverse() : sides).find(({ pick }) => pick);
  let assignment: WordPart[] | undefined;
  if (next?.pick) {
    const { to, from, pick } = next;
    const score = scoreOf(pick.anime.score, from.scoreFormat);
    assignment = choose(
      pick.planned
        ? [
            say`${title(pick.anime)} has been collecting dust on ${whose(to.name)} plan list. ${Who(from.name)} gave it ${score}, so the excuses end today.`,
            say`${title(pick.anime)} is already on ${whose(to.name)} plan list, and ${who(from.name)} gave it ${score}. Today's the day.`,
            say`${Who(to.name)} planned to watch ${title(pick.anime)} ages ago. ${Who(from.name)} gave it ${score}, so consider this a reminder.`,
          ]
        : [
            say`Homework for ${who(to.name)}: ${title(pick.anime)}, straight from ${whose(from.name)} favorites. No excuses.`,
            say`${Who(to.name)} ${isViewer(to.name) ? 'have' : 'has'} been assigned ${title(pick.anime)}. ${Whose(from.name)} orders.`,
          ],
      3
    );
  }

  const sentences: (WordPart[] | null | undefined)[] = {
    close: [agreement, crack, assignment],
    mixed: [agreement, fight, assignment],
    rivals: [fight, concession, assignment],
    unknown: [agreement, nudge, assignment],
  }[tone];
  return sentences.filter((sentence): sentence is WordPart[] => Boolean(sentence));
}
