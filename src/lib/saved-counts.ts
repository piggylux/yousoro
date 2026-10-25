/**
 * How many episodes behind each anime was before the viewer saved new progress for it, by AniList
 * id, until its card shows the new count. It's kept outside the cards because a card that moves
 * after a save can be replaced by a new one, which still has to tick its count down
 */
export const countsBeforeSave = new Map<number, number>();
