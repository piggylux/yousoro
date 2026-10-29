import { describe, expect, it } from 'vitest';

import { describeGap, describeRace } from '#lib/race.js';

const friend = (name: string, progress: number) => ({ name, progress });

describe('watch-along race', () => {
  it("says how far each friend is from the viewer's episode", () => {
    expect(describeGap(10, 7)).toBe('3 episodes ahead of you');
    expect(describeGap(6, 7)).toBe('1 episode behind you');
    expect(describeGap(7, 7)).toBe('On your episode');
  });

  it('names whoever leads, and by how much', () => {
    expect(describeRace(7, [friend('Mika', 10)])).toBe('Mika is 3 episodes ahead of you');
    expect(describeRace(7, [friend('Mika', 10), friend('Sora', 2)])).toBe(
      'Mika leads on episode 10, 3 episodes ahead of you'
    );
    expect(describeRace(7, [friend('Mika', 8), friend('Sora', 8), friend('Ren', 1)])).toBe(
      'Mika and Sora lead on episode 8, 1 episode ahead of you'
    );
  });

  it('cheers a viewer in the lead', () => {
    expect(describeRace(9, [friend('Mika', 4)])).toBe("You're 5 episodes ahead of Mika");
    expect(describeRace(9, [friend('Mika', 8), friend('Sora', 8), friend('Ren', 1)])).toBe(
      "You're in the lead, 1 episode ahead of Mika and Sora"
    );
    expect(describeRace(8, [friend('Mika', 8), friend('Sora', 3)])).toBe(
      'You and Mika lead on episode 8'
    );
  });

  it('notices when everyone is on the same episode', () => {
    expect(describeRace(5, [friend('Mika', 5)])).toBe('You and Mika are both on episode 5');
    expect(describeRace(5, [friend('Mika', 5), friend('Sora', 5)])).toBe("You're all on episode 5");
  });

  it('has nothing to say without friends to race', () => {
    expect(describeRace(5, [])).toBeNull();
  });
});
