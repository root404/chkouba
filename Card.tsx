import React from 'react';
import { CardData } from './types';
import { SuitIcon } from './constants';
import { Bell, Circle } from 'lucide-react';

interface CardProps {
  card: CardData;
  isSelectedByMe: boolean;
  isSelectedByPartner: boolean;
  isCrossed: boolean;
  isCircled: boolean;
  isShaking: boolean;
  onToggleSelect: (id: string) => void;
  onToggleCross: (id: string) => void;
  onToggleCircle: (id: string) => void;
  onSignal: (id: string) => void;
}

export const Card: React.FC<CardProps> = ({
  card,
  isSelectedByMe,
  isSelectedByPartner,
  isCrossed,
  isCircled,
  isShaking,
  onToggleSelect,
  onToggleCross,
  onToggleCircle,
  onSignal,
}) => {
  const handleSignalClick = (e: React.MouseEvent) => {
    e.stopPropagation(); // Prevent toggling selection when clicking signal
    onSignal(card.id);
  };

  const handleClick = (e: React.MouseEvent) => {
    const detail = e.detail;

    // 3 Clicks -> Toggle Transparency (previously Cross)
    if (detail === 3) {
      onToggleCross(card.id);
      return; // Skip selection toggle for this click
    }
    
    // 4 Clicks -> Circle
    if (detail === 4) {
      onToggleCircle(card.id);
      return; // Skip selection toggle for this click
    }
    
    // 1 or 2 clicks -> Toggle selection
    onToggleSelect(card.id);
  };

  return (
    <div
      onClick={handleClick}
      className={`
        relative aspect-[3/4] rounded-lg border-2 cursor-pointer transition-all duration-200 select-none
        flex flex-col items-center justify-between p-1 sm:p-2
        ${isShaking ? 'animate-shake ring-4 ring-yellow-400 z-50' : ''}
        ${isCrossed ? 'opacity-25 grayscale' : 'opacity-100'}
        ${isSelectedByMe ? 'bg-slate-800 border-blue-500 shadow-[0_0_15px_rgba(59,130,246,0.5)]' : 'bg-slate-900 border-slate-700'}
        ${isSelectedByPartner && !isSelectedByMe ? 'bg-slate-900 border-green-500 shadow-[0_0_10px_rgba(34,197,94,0.3)]' : ''}
        ${isSelectedByPartner && isSelectedByMe ? 'border-transparent ring-2 ring-blue-500 ring-offset-2 ring-offset-green-500' : ''}
        hover:bg-slate-800
      `}
    >
      {/* Top Left Rank */}
      <div className="self-start text-xs sm:text-sm font-bold opacity-80">
        {card.label}
      </div>

      {/* Center Suit */}
      <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
        <SuitIcon suit={card.suit} className="w-6 h-6 sm:w-8 sm:h-8 opacity-90" />
      </div>

      {/* Circled Overlay (O) - Yellow */}
      {isCircled && (
        <div className="absolute inset-0 flex items-center justify-center z-30 pointer-events-none">
           <Circle className="w-12 h-12 sm:w-20 sm:h-20 text-yellow-400 opacity-90" strokeWidth={3} />
        </div>
      )}

      {/* Partner Indicator Dot (If they selected it) */}
      {isSelectedByPartner && (
        <div className="absolute top-1 right-1 w-2 h-2 sm:w-3 sm:h-3 rounded-full bg-green-500 animate-pulse shadow-lg" title="Partner Selected" />
      )}

      {/* My Selection Indicator (Corner) */}
      {isSelectedByMe && (
        <div className="absolute bottom-1 left-1 w-2 h-2 rounded-full bg-blue-500" />
      )}

      {/* Action Buttons */}
      <div className="self-end z-10">
        <button
          onClick={handleSignalClick}
          className="p-1 rounded-full hover:bg-slate-700 text-slate-500 hover:text-yellow-400 transition-colors"
          title="Signal Partner to Play"
        >
          <Bell size={14} />
        </button>
      </div>
    </div>
  );
};