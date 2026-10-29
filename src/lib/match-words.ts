import { formatScore, type ScoreFormat } from '#lib/score.js';
import type { ScoredAnime, TasteMatch, TasteProfile } from '#lib/types/match.js';

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
 * its link preview, and jokes made to be shared, one of them for each pair
 */
const TIERS: { min: number; label: string; jokes: Joke[] }[] = [
  {
    min: 95,
    label: 'Same brain cell',
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

/**
 * A few closing jokes on a match, from its own anime: what both loved, the one they fight over,
 * and homework for the viewer. The wording varies from one pair to the next, but a match always
 * reads the same, so a shared link shows what was shared
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
  const sentences: WordPart[][] = [];

  if (match.inCommon >= 100) {
    const count = match.inCommon.toLocaleString();
    sentences.push(
      choose(
        [
          say`${count} anime in common. That's a lot of hours not touching grass, together.`,
          say`${count} anime in common, which is basically a shared personality at this point.`,
        ],
        0
      )
    );
  }

  const [loved, alsoLoved] = match.bothLoved;
  if (loved) {
    const titles = alsoLoved
      ? [title(loved.anime), { text: ' and ' }, title(alsoLoved.anime)]
      : [title(loved.anime)];
    const are = alsoLoved ? 'are' : 'is';
    sentences.push(
      choose(
        [
          say`${titles} ${are} the load-bearing anime of this friendship.`,
          say`${Pair} agree ${titles} ${are} peak. Nobody tell the comment section.`,
          say`On ${titles}, ${pair} could finish each other's sentences, spoilers included.`,
        ],
        1
      )
    );
  }

  const [split] = match.disagreements;
  if (split) {
    const scoreA = scoreOf(split.a, a.scoreFormat);
    const scoreB = scoreOf(split.b, b.scoreFormat);
    sentences.push(
      choose(
        [
          say`Never bring up ${title(split.anime)} at dinner: ${who(a.name)} gave it ${scoreA}, ${who(b.name)} gave it ${scoreB}, and someone is wrong.`,
          say`${title(split.anime)} is where this friendship goes to fight, ${scoreA} from ${who(a.name)} against ${scoreB} from ${who(b.name)}.`,
          say`${title(split.anime)}: ${scoreA} from ${who(a.name)}, ${scoreB} from ${who(b.name)}. Settle it with a rewatch, or a duel.`,
        ],
        2
      )
    );
  }

  if (match.inCommon === 0) {
    sentences.push(
      say`Zero anime in common. Either a beautiful friendship is about to begin, or a very long argument.`
    );
  } else if (match.percent === null) {
    sentences.push(
      say`Not enough shared scores to call it yet. Go score some anime, the fate of this friendship depends on it.`
    );
  }

  // Homework for the viewer first, or for whoever was compared with the list's owner
  const sides = [
    { to: b, from: a, pick: match.picksForB[0] },
    { to: a, from: b, pick: match.picksForA[0] },
  ];
  const next = (isViewer(a.name) ? sides.reverse() : sides).find(({ pick }) => pick);
  if (next) {
    const { to, from, pick } = next;
    const score = scoreOf(pick.anime.score, from.scoreFormat);
    sentences.push(
      pick.planned
        ? say`${title(pick.anime)} has been collecting dust on ${whose(to.name)} plan list. ${Who(from.name)} gave it ${score}, so the excuses end today.`
        : choose(
            [
              say`Homework for ${who(to.name)}: ${title(pick.anime)}, straight from ${whose(from.name)} favorites. No excuses.`,
              say`${Who(to.name)} ${isViewer(to.name) ? 'have' : 'has'} been assigned ${title(pick.anime)}. ${Whose(from.name)} orders.`,
            ],
            3
          )
    );
  }
  return sentences;
}
