'use client';

import { useCallback, useEffect, useRef } from 'react';
import type { FlattenedTrack } from '@/lib/types';
import { cn, formatDuration, getTrackDisplayTitle } from '@/lib/utils';

type QueuePopoverProps = {
  open: boolean;
  onClose: () => void;
  queue: string[];
  queueIndex: number;
  tracksById: Map<string, FlattenedTrack>;
  sourceLabel: string;
  onPlayIndex: (index: number) => void;
};

export function QueuePopover({
  open,
  onClose,
  queue,
  queueIndex,
  tracksById,
  sourceLabel,
  onPlayIndex,
}: QueuePopoverProps) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        onClose();
      }
    };
    document.addEventListener('click', handler, true);
    return () => document.removeEventListener('click', handler, true);
  }, [open, onClose]);

  if (!open) return null;

  const sections = [
    { label: 'Now Playing', start: Math.max(queueIndex, 0), end: Math.max(queueIndex, 0) + 1 },
    { label: 'Next Up', start: Math.max(queueIndex + 1, 0), end: queue.length },
  ];

  return (
    <div
      ref={ref}
      className="absolute right-0 bottom-[calc(100%+18px)] w-[min(360px,calc(100vw-32px))] max-h-[420px] overflow-auto p-3.5 rounded-3xl border border-white/10 shadow-[0_24px_60px_rgba(0,0,0,0.4)]"
      style={{
        background:
          'linear-gradient(180deg, rgba(20,24,36,0.98) 0%, rgba(14,17,26,0.98) 100%), radial-gradient(circle at top right, rgba(249,115,22,0.18), transparent 32%)',
      }}
    >
      <div className="flex items-baseline justify-between gap-2.5 mb-3">
        <div className="text-[13px] font-bold tracking-wide uppercase text-white/[0.68]">Current Queue</div>
        <div className="text-[11px] text-white/[0.48]">
          {queue.length ? `${queue.length} tracks` : 'No queue'}
        </div>
      </div>

      {!queue.length ? (
        <div className="p-4 rounded-2xl bg-white/[0.04] text-xs text-white/[0.58]">
          Start any track to build a queue from the playlist you are currently viewing.
        </div>
      ) : (
        sections.map((section) => {
          if (section.start >= queue.length) return null;
          return (
            <div key={section.label}>
              <div className="text-[10px] tracking-[0.16em] uppercase text-white/[0.45] mt-3.5 mb-2">
                {section.label}
              </div>
              {Array.from({ length: section.end - section.start }, (_, i) => {
                const index = section.start + i;
                const track = tracksById.get(queue[index]);
                if (!track) return null;
                return (
                  <button
                    key={index}
                    onClick={() => {
                      onPlayIndex(index);
                      onClose();
                    }}
                    className={cn(
                      'w-full border-0 bg-transparent text-inherit grid grid-cols-[24px_minmax(0,1fr)_auto] gap-2.5 items-center p-2.5 px-3 rounded-2xl cursor-pointer text-left hover:bg-white/[0.06]',
                      index === queueIndex && 'bg-[#ff2975]/[0.16]',
                    )}
                  >
                    <span
                      className={cn(
                        'text-[11px] font-mono',
                        index === queueIndex ? 'text-white/[0.82]' : 'text-white/[0.45]',
                      )}
                    >
                      {String(index + 1).padStart(2, '0')}
                    </span>
                    <div className="min-w-0">
                      <div className="text-[13px] font-semibold truncate">
                        {getTrackDisplayTitle(track)}
                      </div>
                      <div className="text-[11px] text-white/[0.5] truncate mt-0.5">
                        {sourceLabel}
                        {queue.length > 0 && queueIndex >= 0
                          ? ` • ${index + 1} of ${queue.length}`
                          : ''}
                      </div>
                    </div>
                    <span className="text-[11px] text-white/[0.5] font-mono">
                      {formatDuration(track.duration)}
                    </span>
                  </button>
                );
              })}
            </div>
          );
        })
      )}
    </div>
  );
}
