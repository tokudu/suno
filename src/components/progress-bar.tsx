'use client';

import { useCallback } from 'react';
import { formatDuration } from '@/lib/utils';

type ProgressBarProps = {
  currentTime: number;
  duration: number;
  onSeek: (time: number) => void;
};

export function ProgressBar({ currentTime, duration, onSeek }: ProgressBarProps) {
  const ratio = duration > 0 ? Math.max(0, Math.min(1, currentTime / duration)) : 0;
  const remaining = duration > 0 ? Math.max(0, duration - currentTime) : 0;

  const handleClick = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      if (!duration || duration <= 0) return;
      const rect = e.currentTarget.getBoundingClientRect();
      const clickRatio = rect.width > 0 ? (e.clientX - rect.left) / rect.width : 0;
      onSeek(Math.max(0, Math.min(duration, clickRatio * duration)));
    },
    [duration, onSeek],
  );

  return (
    <div className="w-full max-w-[520px] grid grid-cols-[42px_1fr_42px] gap-2.5 items-center text-[11px] text-white/[0.58]">
      <span className="font-mono">{formatDuration(currentTime) || '0:00'}</span>
      <div
        className="relative h-1.5 rounded-full bg-white/[0.14] overflow-hidden cursor-pointer"
        onClick={handleClick}
      >
        <div
          className="absolute inset-y-0 left-0 rounded-full"
          style={{
            width: `${ratio * 100}%`,
            background: 'linear-gradient(90deg, rgba(255,41,117,0.9), rgba(140,30,255,0.8))',
          }}
        />
      </div>
      <span className="font-mono">{duration > 0 ? formatDuration(remaining) : '0:00'}</span>
    </div>
  );
}
