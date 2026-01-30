export type Suit = 'DINARI' | 'BSTONI' | 'KOB' | 'SBATI';

export interface CardData {
  id: string;
  rank: number; // 1-7, 8(J), 9(Q), 10(K)
  suit: Suit;
  label: string;
}

export type PlayerRole = 'ME' | 'PARTNER';

export interface SignalMessage {
  type: 'SYNC_SELECTION' | 'SIGNAL_SHAKE' | 'RESET' | 'SYNC_CROSSED' | 'SYNC_CIRCLE';
  role?: PlayerRole; // Who sent it
  selection?: string[]; // List of selected Card IDs
  crossed?: string[]; // List of crossed out Card IDs
  circled?: string[]; // List of circled Card IDs
  cardId?: string; // For shake
}
