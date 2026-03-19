'use client';

import { cn } from '@/lib/utils';

type PlayerControlsProps = {
  playing: boolean;
  hasTrack: boolean;
  canPrev: boolean;
  canNext: boolean;
  onPlayPause: () => void;
  onPrev: () => void;
  onNext: () => void;
};

const controlBase =
  'border border-white/[0.12] bg-white/[0.08] text-gray-50 rounded-full cursor-pointer transition-all duration-100 hover:bg-white/[0.14] hover:border-white/[0.2] hover:-translate-y-px disabled:opacity-[0.38] disabled:cursor-not-allowed disabled:translate-y-0';

export function PlayerControls({
  playing,
  hasTrack,
  canPrev,
  canNext,
  onPlayPause,
  onPrev,
  onNext,
}: PlayerControlsProps) {
  return (
    <div className="flex items-center justify-center gap-3">
      <button
        className={cn(controlBase, 'w-[38px] h-[38px] inline-flex items-center justify-center text-sm')}
        onClick={onPrev}
        disabled={!canPrev}
        aria-label="Previous track"
      >
        ⏮
      </button>
      <button
        className={cn(
          'w-[46px] h-[46px] inline-flex items-center justify-center rounded-full cursor-pointer text-white',
          'bg-gradient-to-br from-[#ff2975] to-[#8c1eff] border-transparent shadow-[0_10px_24px_rgba(255,41,117,0.35)]',
          'disabled:opacity-[0.38] disabled:cursor-not-allowed',
        )}
        onClick={onPlayPause}
        disabled={!hasTrack}
        aria-label={playing ? 'Pause' : 'Play'}
      >
        {playing ? '⏸' : '▶'}
      </button>
      <button
        className={cn(controlBase, 'w-[38px] h-[38px] inline-flex items-center justify-center text-sm')}
        onClick={onNext}
        disabled={!canNext}
        aria-label="Next track"
      >
        ⏭
      </button>
    </div>
  );
}
