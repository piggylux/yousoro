import { describe, expect, it } from 'vitest';

import {
  describeMatch,
  finalThought,
  matchComment,
  voiceFor,
  type WordPart,
} from '#lib/match-words.js';
import type { ScoredAnime, TasteMatch, TasteProfile } from '#lib/types/match.js';

function anime(id: number, title: string, score = 9): ScoredAnime {
  return {
    id,
    title,
    coverUrl: null,
    isAdult: false,
    meanScore: null,
    score,
    score100: score * 10,
  };
}

function person(id: number, name: string): TasteProfile {
  return { id, name, avatarUrl: null, scoreFormat: 'POINT_10', scored: [], seen: [], planned: [] };
}

const FRIEREN = anime(1, 'Frieren');
const MUSHISHI = anime(2, 'Mushishi');
const EX_ARM = anime(3, 'Ex-Arm');
const MONSTER = anime(4, 'Monster');
const UTENA = anime(5, 'Utena');

function match(overrides: Partial<TasteMatch> = {}): TasteMatch {
  return {
    percent: 80,
    inCommon: 120,
    bothScored: 60,
    bothLoved: [
      { anime: FRIEREN, a: 10, b: 9 },
      { anime: MUSHISHI, a: 9, b: 9 },
    ],
    disagreements: [{ anime: EX_ARM, a: 8, b: 2 }],
    picksForA: [{ anime: UTENA, planned: false }],
    picksForB: [{ anime: MONSTER, planned: false }],
    ...overrides,
  };
}

/** The sentences as read, with plain spaces in scores */
const read = (sentences: WordPart[][]) =>
  sentences
    .map((sentence) => sentence.map(({ text }) => text).join(''))
    .join(' ')
    .replaceAll(' ', ' ');

const alice = person(1, 'Alice');
const bob = person(2, 'Bob');

describe('the voice of a match', () => {
  it('names people, or says "you" to the viewer whatever case their name is typed in', () => {
    const voice = voiceFor('ALICE');
    expect([voice.who('Alice'), voice.Who('alice'), voice.whose('Alice')]).toEqual([
      'you',
      'You',
      'your',
    ]);
    expect([voice.who('bob'), voice.Who('bob'), voice.Whose('bob')]).toEqual([
      'bob',
      'bob',
      "bob's",
    ]);
    expect(voiceFor(null).isViewer('Alice')).toBe(false);
  });
});

describe('match comments', () => {
  it('describes a percent in a few words', () => {
    expect(describeMatch(97)).toBe('Same brain cell');
    expect(describeMatch(92)).toBe('Kindred spirits');
    expect(describeMatch(70)).toBe('Watch-party ready');
    expect(describeMatch(55)).toBe('Couch compatible');
    expect(describeMatch(40)).toBe('Friendly rivals');
    expect(describeMatch(25)).toBe('Polar opposites');
    expect(describeMatch(12)).toBe('Sworn rivals');
  });

  // Pairs whose ids add up to 0, 1 and 2 more than a multiple of three, each given another joke
  const pairs = [0, 1, 2].map((extra) => [{ id: 1 }, { id: 2 + extra }] as const);
  const PERCENTS = [97, 88, 75, 60, 45, 30, 10];

  it('says a joke to the two of them, or about them', () => {
    const [a, b] = pairs[0];
    expect(matchComment(97, a, b, true)).toBe(
      "Are you two sure you're not one person with two accounts?"
    );
    expect(matchComment(97, a, b, false)).toBe(
      "Are these two sure they're not one person with two accounts?"
    );
    expect(matchComment(45, a, b, false)).toBe(
      'Rivals who respect each other. Very shōnen of them.'
    );
    expect(matchComment(10, a, b, true)).toBe(
      'Every great story needs a rival. You two found yours.'
    );
  });

  it('gives each pair one of three jokes for its label, the same whichever comes first', () => {
    for (const percent of PERCENTS) {
      const jokes = pairs.map(([a, b]) => matchComment(percent, a, b, true));
      expect(new Set(jokes).size).toBe(3);
      for (const [a, b] of pairs) {
        expect(matchComment(percent, b, a, true)).toBe(matchComment(percent, a, b, true));
      }
    }
    const [a, b] = pairs[1];
    expect(matchComment(60, a, b, true)).toBe(
      'Not quite the main pairing, but the fandom ships it anyway.'
    );
  });

  it('keeps every joke to one line of a link preview', () => {
    for (const percent of PERCENTS) {
      for (const [a, b] of pairs) {
        for (const toThem of [true, false]) {
          expect(matchComment(percent, a, b, toThem).length).toBeLessThanOrEqual(80);
        }
      }
    }
  });
});

describe('final thoughts', () => {
  it("jokes about the pair's own anime, keeping titles apart from the words", () => {
    const sentences = finalThought(match(), alice, bob, voiceFor(null));
    expect(read(sentences)).toBe(
      '120 anime in common, which is basically a shared personality at this point. ' +
        'Alice and Bob agree Frieren and Mushishi are peak. Nobody tell the comment section. ' +
        'Never bring up Ex-Arm at dinner: Alice gave it 8 / 10, Bob gave it 2 / 10, and someone is wrong. ' +
        "Homework for Bob: Monster, straight from Alice's favorites. No excuses."
    );
    const titles = sentences.flat().filter((part) => part.title);
    expect(titles.map(({ text }) => text)).toEqual(['Frieren', 'Mushishi', 'Ex-Arm', 'Monster']);
    // Scores stay on one line
    expect(sentences[2].map(({ text }) => text).join('')).toContain('8 / 10');
  });

  it('talks to the viewer, and gives them the homework', () => {
    expect(read(finalThought(match(), alice, bob, voiceFor('bob')))).toBe(
      '120 anime in common, which is basically a shared personality at this point. ' +
        'You and Alice agree Frieren and Mushishi are peak. Nobody tell the comment section. ' +
        'Never bring up Ex-Arm at dinner: Alice gave it 8 / 10, you gave it 2 / 10, and someone is wrong. ' +
        "Homework for you: Monster, straight from Alice's favorites. No excuses."
    );
    expect(read(finalThought(match(), alice, bob, voiceFor('alice')))).toContain(
      "Homework for you: Utena, straight from Bob's favorites."
    );
  });

  it('reads the same every time for a pair, and differently for another pair', () => {
    const thought = (other: TasteProfile) =>
      read(finalThought(match(), alice, other, voiceFor(null)));
    expect(thought(bob)).toBe(thought(bob));
    const carol = person(3, 'Carol');
    expect(thought(carol)).not.toBe(thought(bob));
    expect(thought(carol)).toContain(
      "120 anime in common. That's a lot of hours not touching grass, together."
    );
  });

  it('mixes its wordings, rather than always pairing a joke with the same sentences', () => {
    const combinations = new Set(
      Array.from({ length: 9 }, (_, index) => {
        const other = person(2 + index, 'Other');
        const agreement = read([finalThought(match(), alice, other, voiceFor(null))[1]]);
        return `${matchComment(60, alice, other, true)} ${agreement}`;
      })
    );
    expect(combinations.size).toBe(9);
  });

  it('calls out a favorite that has been waiting on a plan list', () => {
    const planned = match({ picksForB: [{ anime: MONSTER, planned: true }] });
    expect(read(finalThought(planned, alice, bob, voiceFor('bob')))).toContain(
      'Monster has been collecting dust on your plan list. Alice gave it 9 / 10, so the excuses end today.'
    );
  });

  it('still has something to say with no anime in common, or too few scores', () => {
    const empty = match({
      percent: null,
      inCommon: 0,
      bothScored: 0,
      bothLoved: [],
      disagreements: [],
    });
    expect(read(finalThought(empty, alice, bob, voiceFor(null)))).toMatch(
      /^Zero anime in common\. Either a beautiful friendship is about to begin/
    );
    const unscored = match({ percent: null, inCommon: 12, bothScored: 2, disagreements: [] });
    expect(read(finalThought(unscored, alice, bob, voiceFor(null)))).toContain(
      'Not enough shared scores to call it yet.'
    );
    expect(
      finalThought(match({ ...empty, picksForA: [], picksForB: [] }), alice, bob, voiceFor(null))
    ).toHaveLength(1);
  });
});
