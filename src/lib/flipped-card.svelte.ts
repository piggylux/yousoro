/**
 * The one anime card showing its back, by the card's own id; null when every card shows its
 * front. Turning a card over turns the previous one back
 */
export const flippedCard = $state<{ id: string | null }>({ id: null });
