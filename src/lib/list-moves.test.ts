import { beforeEach, describe, expect, it, vi } from 'vitest';

import { recordOwnWatchingEntry } from '#lib/friend-watching.js';
import { expireRememberedList } from '#lib/list-data.js';
import { forgetRememberedLists, noteListMove } from '#lib/list-moves.js';
import { forgetPlanned, markStarted } from '#lib/planning.js';
import { forgetSeasonTaste, rememberTasteMove } from '#lib/season-taste.js';

vi.mock('#lib/friend-watching.js', () => ({ recordOwnWatchingEntry: vi.fn() }));
vi.mock('#lib/list-data.js', () => ({ expireRememberedList: vi.fn() }));
vi.mock('#lib/planning.js', () => ({ forgetPlanned: vi.fn(), markStarted: vi.fn() }));
vi.mock('#lib/season-taste.js', () => ({ forgetSeasonTaste: vi.fn(), rememberTasteMove: vi.fn() }));

const viewer = { id: 1, name: 'Fixture', avatarUrl: null };
const list = { domain: 'anilist' as const, username: 'Fixture', friendsViewer: viewer };
const anime = { id: 10, malId: 20, title: 'Frieren', isAdult: false, coverUrl: 'cover.jpg' };

beforeEach(() => vi.clearAllMocks());

describe('what the tab remembers once an anime moves', () => {
  it('reads the plan list again after a plan, and leaves the Watching list be', () => {
    noteListMove(list, anime, { list: 'PLANNING' });

    expect(forgetPlanned).toHaveBeenCalledWith('anilist', 'Fixture');
    expect(expireRememberedList).not.toHaveBeenCalled();
    expect(recordOwnWatchingEntry).not.toHaveBeenCalled();
  });

  it('takes a started anime off the plan lists and tells the friends pages', () => {
    noteListMove(list, anime, { list: 'CURRENT', progress: 2 });

    expect(markStarted).toHaveBeenCalledWith('anilist', 'Fixture', anime);
    expect(expireRememberedList).toHaveBeenCalledWith('Fixture', 'anilist');
    expect(recordOwnWatchingEntry).toHaveBeenCalledWith(
      viewer,
      expect.objectContaining({ id: 10, thumbnailUrl: 'cover.jpg', currentEpisode: 2 }),
      'CURRENT'
    );
  });

  it('undoing a start reads both lists again, and the owner no longer watches it', () => {
    noteListMove(list, anime, { list: 'CURRENT', undone: true });

    expect(forgetPlanned).toHaveBeenCalled();
    expect(markStarted).not.toHaveBeenCalled();
    expect(expireRememberedList).toHaveBeenCalled();
    expect(recordOwnWatchingEntry).toHaveBeenCalledWith(viewer, expect.anything(), 'PLANNING');
  });

  it('tells the friends pages nothing for someone else’s list', () => {
    noteListMove({ ...list, friendsViewer: null }, anime, { list: 'CURRENT' });

    expect(recordOwnWatchingEntry).not.toHaveBeenCalled();
  });

  it("moves the anime in the season page's remembered taste, by the list's own id", () => {
    noteListMove(list, anime, { list: 'PLANNING' });
    expect(rememberTasteMove).toHaveBeenCalledWith('anilist', 'Fixture', 10, 'PLANNING');

    noteListMove({ ...list, domain: 'myanimelist' }, anime, { list: 'CURRENT' });
    expect(rememberTasteMove).toHaveBeenLastCalledWith('myanimelist', 'Fixture', 20, 'CURRENT');
    expect(forgetSeasonTaste).not.toHaveBeenCalled();
  });

  it('forgets the remembered taste when an add is undone, or the anime has no id there', () => {
    noteListMove(list, anime, { list: 'CURRENT', undone: true });
    expect(forgetSeasonTaste).toHaveBeenCalledWith('anilist', 'Fixture');

    noteListMove(list, { ...anime, id: null }, { list: 'PLANNING' });
    expect(forgetSeasonTaste).toHaveBeenCalledTimes(2);
    expect(rememberTasteMove).not.toHaveBeenCalled();
  });

  it("forgets every list the tab remembers after a change it can't follow, as a revert", () => {
    forgetRememberedLists('myanimelist', 'Fixture');

    expect(expireRememberedList).toHaveBeenCalledWith('Fixture', 'myanimelist');
    expect(forgetPlanned).toHaveBeenCalledWith('myanimelist', 'Fixture');
    expect(forgetSeasonTaste).toHaveBeenCalledWith('myanimelist', 'Fixture');
  });
});
