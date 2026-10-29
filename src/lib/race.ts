import { joinNames } from '#lib/match-words.js';

/** Someone watching an anime alongside the viewer, and the episode they're on */
type Runner = { name: string; progress: number };

const episodes = (count: number) => `${count.toLocaleString()} episode${count === 1 ? '' : 's'}`;
const names = (people: Runner[]) => joinNames(people.map((person) => person.name));

/** Where someone stands against the viewer, for their row: "3 episodes ahead of you" */
export function describeGap(progress: number, viewerProgress: number): string {
  const gap = progress - viewerProgress;
  if (gap === 0) return 'On your episode';
  return `${episodes(Math.abs(gap))} ${gap > 0 ? 'ahead of' : 'behind'} you`;
}

/**
 * Who's ahead on an anime the viewer watches with friends, in a sentence: whoever leads and by how
 * much, or that the viewer does. Null without anyone to race
 */
export function describeRace(viewerProgress: number, friends: Runner[]): string | null {
  if (!friends.length) return null;
  const top = Math.max(...friends.map((friend) => friend.progress));
  const leaders = friends.filter((friend) => friend.progress === top);

  if (top < viewerProgress) {
    return friends.length === 1
      ? `You're ${episodes(viewerProgress - top)} ahead of ${friends[0].name}`
      : `You're in the lead, ${episodes(viewerProgress - top)} ahead of ${names(leaders)}`;
  }
  if (top === viewerProgress) {
    if (leaders.length === friends.length) {
      return friends.length === 1
        ? `You and ${friends[0].name} are both on episode ${top}`
        : `You're all on episode ${top}`;
    }
    return `You and ${names(leaders)} lead on episode ${top}`;
  }
  const gap = episodes(top - viewerProgress);
  if (friends.length === 1) return `${friends[0].name} is ${gap} ahead of you`;
  return leaders.length === 1
    ? `${leaders[0].name} leads on episode ${top}, ${gap} ahead of you`
    : `${names(leaders)} lead on episode ${top}, ${gap} ahead of you`;
}
