export type PlayerRole = 'ME' | 'PARTNER';

export type Suit = 'DINARI' | 'BSTONI' | 'KOB' | 'SBATI';

export interface CardData {
  id: string;
  rank: number;
  suit: Suit;
  label: string;
}

export interface Point {
  x: number; // Normalized 0-1
  y: number; // Normalized 0-1
}

export interface Stroke {
  id: string;
  points: Point[];
  color: string;
  isRemote: boolean;
}

export interface SignalMessage {
  type: 'SYNC_STROKE' | 'CLEAR_BOARD' | 'RESET' | 'PING';
  stroke?: Stroke;
}