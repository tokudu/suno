'use client';

import { useState, useCallback, useMemo } from 'react';
import type { FlattenedTrack } from '@/lib/types';
import type { LibraryPlaylist } from '@/lib/types';
import { getTrackDisplayTitle } from '@/lib/utils';
import { getTrackImageUrl } from '@/lib/audio-url';
import { PlayerControls } from './player-controls';
import { ProgressBar } from './progress-bar';
import { QueuePopover } from './queue-popover';

function hashHue(id: string): number {
  let hash = 0;
  for (let i = 0; i < id.length; i++) {
    hash = id.charCodeAt(i) + ((hash << 5) - hash);
  }
  return Math.abs(hash) % 360;
}

type PlayerProps = {
  currentTrackId: string | null;
  tracksById: Map<string, FlattenedTrack>;
  playing: boolean;
  currentTime: number;
  duration: number;
  queue: string[];
  queueIndex: number;
  queueSourcePlaylistId: string | null;
  playlists: LibraryPlaylist[];
  onPlayPause: () => void;
  onPrev: () => void;
  onNext: () => void;
  onSeek: (time: number) => void;
  onPlayQueueIndex: (index: number) => void;
  onDjToggle: () => void;
};

export function Player({
  currentTrackId,
  tracksById,
  playing,
  currentTime,
  duration,
  queue,
  queueIndex,
  queueSourcePlaylistId,
  playlists,
  onPlayPause,
  onPrev,
  onNext,
  onSeek,
  onPlayQueueIndex,
  onDjToggle,
}: PlayerProps) {
  const [queueOpen, setQueueOpen] = useState(false);
  const track = currentTrackId ? tracksById.get(currentTrackId) : null;

  const sourceLabel = useMemo(() => {
    const source = playlists.find((p) => p.id === queueSourcePlaylistId);
    return source?.name || 'All Tracks';
  }, [playlists, queueSourcePlaylistId]);

  const subtitle = track
    ? `${sourceLabel}${queue.length > 0 && queueIndex >= 0 ? ` • ${queueIndex + 1} of ${queue.length}` : ''}`
    : 'Click any play button to build a queue from the visible playlist.';

  return (
    <div
      className="text-gray-50 border-t border-white/[0.06] rounded-b-3xl"
      style={{
        background:
          'linear-gradient(180deg, rgba(15,18,27,0.6) 0%, rgba(10,12,18,0.8) 100%)',
      }}
    >
      <div className="grid grid-cols-1 gap-2 items-center px-3 sm:px-4 py-2 sm:py-2.5 md:grid-cols-[minmax(0,1.2fr)_minmax(280px,1fr)_minmax(120px,0.6fr)] md:gap-3">
        {/* Now playing info */}
        <div className="flex items-center gap-3.5 min-w-0">
          {(() => {
            const imageUrl = track ? getTrackImageUrl(track) : null;
            if (imageUrl) {
              return (
                <img
                  src={imageUrl}
                  alt=""
                  className="w-12 h-12 rounded-xl flex-none object-cover shadow-[0_8px_20px_rgba(0,0,0,0.3)]"
                />
              );
            }
            const hue = track ? hashHue(track.id) : 25;
            return (
              <div
                className="w-12 h-12 rounded-xl flex-none grid place-items-center text-lg font-bold text-white/[0.92] shadow-[inset_0_1px_0_rgba(255,255,255,0.22),0_8px_20px_rgba(0,0,0,0.2)]"
                style={{
                  background: `linear-gradient(135deg, hsl(${hue}, 80%, 65%), hsl(${(hue + 60) % 360}, 80%, 55%))`,
                }}
              >
                {track ? '' : 'T'}
              </div>
            );
          })()}
          <div className="min-w-0">
            <div className="text-[10px] uppercase tracking-[0.18em] text-white/[0.52] mb-1.5">
              TOKUDU Queue
            </div>
            <div className="text-base font-bold truncate mb-1">
              {track ? getTrackDisplayTitle(track) : 'Select a track'}
            </div>
            <div className="text-xs text-white/[0.64] truncate">{subtitle}</div>
          </div>
        </div>

        {/* Center controls */}
        <div className="flex flex-col items-center gap-2.5">
          <PlayerControls
            playing={playing}
            hasTrack={!!currentTrackId}
            canPrev={queueIndex > 0}
            canNext={queueIndex >= 0 && queueIndex < queue.length - 1}
            onPlayPause={onPlayPause}
            onPrev={onPrev}
            onNext={onNext}
          />
          <ProgressBar currentTime={currentTime} duration={duration} onSeek={onSeek} />
        </div>

        {/* Right section */}
        <div className="hidden md:flex items-center justify-end gap-2.5 sm:gap-3.5 relative md:flex-nowrap">
          <button
            onClick={onDjToggle}
            className="px-4 py-2.5 text-xs font-semibold tracking-wide border border-white/[0.12] bg-gradient-to-r from-[#ff2975]/20 to-[#00d4ff]/20 text-gray-50 rounded-full cursor-pointer hover:from-[#ff2975]/30 hover:to-[#00d4ff]/30 hover:border-white/[0.2] hover:-translate-y-px transition-all duration-100"
          >
            DJ
          </button>
          <button
            onClick={() => setQueueOpen((o) => !o)}
            className="px-4 py-2.5 text-xs font-semibold tracking-wide border border-white/[0.12] bg-white/[0.08] text-gray-50 rounded-full cursor-pointer hover:bg-white/[0.14] hover:border-white/[0.2] hover:-translate-y-px transition-all duration-100"
          >
            Queue
          </button>
          <QueuePopover
            open={queueOpen}
            onClose={() => setQueueOpen(false)}
            queue={queue}
            queueIndex={queueIndex}
            tracksById={tracksById}
            sourceLabel={sourceLabel}
            onPlayIndex={onPlayQueueIndex}
          />
        </div>
      </div>
    </div>
  );
}
