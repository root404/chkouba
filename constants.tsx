import React from 'react';
import { CardData, Suit } from './types';
import { Diamond, Club, Heart, Spade } from 'lucide-react';

export const SUITS: Suit[] = ['DINARI', 'BSTONI', 'KOB', 'SBATI'];

// Chkobba Ranks: A(1), 2, 3, 4, 5, 6, 7, J(8), Q(9), K(10)
export const RANKS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];

export const getRankLabel = (rank: number): string => {
  if (rank === 1) return 'A';
  if (rank === 8) return 'J';
  if (rank === 9) return 'Q';
  if (rank === 10) return 'K';
  return rank.toString();
};

export const generateDeck = (): CardData[] => {
  const deck: CardData[] = [];
  SUITS.forEach((suit) => {
    RANKS.forEach((rank) => {
      deck.push({
        id: `${suit}-${rank}`,
        rank,
        suit,
        label: getRankLabel(rank),
      });
    });
  });
  return deck;
};

export const SuitIcon = ({ suit, className }: { suit: Suit; className?: string }) => {
  switch (suit) {
    case 'DINARI': // Diamonds - Gold/Orange usually, but Red traditionally in standard decks. 
                   // Chkobba Dinari is specific, but we map to Diamond.
      return <Diamond className={`text-yellow-500 ${className}`} fill="currentColor" />;
    case 'BSTONI': // Clubs
      return <Club className={`text-slate-400 ${className}`} fill="currentColor" />;
    case 'KOB':    // Hearts
      return <Heart className={`text-red-500 ${className}`} fill="currentColor" />;
    case 'SBATI':  // Spades
      return <Spade className={`text-slate-400 ${className}`} fill="currentColor" />;
  }
};
