'use client';

import type { FlattenedTrack } from '@/lib/types';
import { cn, formatDuration, formatCreatedDate, parseTags, getTrackDisplayTitle } from '@/lib/utils';
import { getTrackImageUrl } from '@/lib/audio-url';
import { Badge } from './badge';
import { KeyBadge } from './key-badge';

type TrackRowProps = {
  track: FlattenedTrack;
  position: number | null;
  isPlaying: boolean;
  isCurrent: boolean;
  onTogglePlay: () => void;
};

export function TrackRow({ track, position, isPlaying, isCurrent, onTogglePlay }: TrackRowProps) {
  const isPublished = track.isPublic === true;
  const tags = parseTags(track);
  const playCount = Number((track.metadata as Record<string, unknown>)?.play_count);
  const imageUrl = getTrackImageUrl(track);

  return (
    <tr
      className={cn(
        'group/row transition-colors duration-150',
        isCurrent ? 'bg-orange-500/[0.08]' : 'hover:bg-black/[0.03]',
        !isPublished && 'opacity-90',
      )}
    >
      <td className="text-right font-mono px-2.5 py-2 border-b border-gray-100 text-xs whitespace-nowrap text-muted">
        {position ?? ''}
      </td>
      <td className="px-2.5 py-1.5 border-b border-gray-100 text-xs whitespace-nowrap">
        <div className="relative w-[38px] h-[38px] flex-none">
          {imageUrl ? (
            <img
              src={imageUrl}
              alt=""
              className="w-[38px] h-[38px] rounded-lg object-cover shadow-sm"
              loading="lazy"
            />
          ) : (
            <div className="w-[38px] h-[38px] rounded-lg bg-gradient-to-br from-gray-200 to-gray-300" />
          )}
          <button
            onClick={onTogglePlay}
            disabled={!track.hasMp3}
            className={cn(
              'absolute inset-0 w-full h-full rounded-lg text-[13px] inline-flex items-center justify-center cursor-pointer transition-all duration-150',
              isPlaying
                ? 'bg-black/40 text-white'
                : 'bg-black/30 text-white/80 group-hover/row:bg-black/40 group-hover/row:text-white',
              'disabled:cursor-not-allowed',
            )}
            title={isPlaying ? 'Pause' : 'Play'}
          >
            {isPlaying ? '⏸' : '▶'}
          </button>
        </div>
      </td>
      <td className="px-2.5 py-2 border-b border-gray-100 text-sm font-semibold whitespace-normal break-all">
        {getTrackDisplayTitle(track)}
      </td>
      <td className="px-2.5 py-2 border-b border-gray-100 text-xs font-mono whitespace-nowrap">
        {formatDuration(track.duration)}
      </td>
      <td className="px-2.5 py-2 border-b border-gray-100 text-xs font-mono whitespace-nowrap">
        {typeof track.bpm === 'number' ? Math.round(track.bpm) : ''}
      </td>
      <td className="px-2.5 py-2 border-b border-gray-100 text-xs whitespace-nowrap">
        <KeyBadge musicalKey={track.musicalKey} />
      </td>
      <td className="px-2.5 py-2 border-b border-gray-100 text-xs whitespace-normal">
        <div className="flex flex-wrap gap-1.5">
          {tags.map((tag) => (
            <Badge key={tag} label={tag} />
          ))}
        </div>
      </td>
      <td className="px-2.5 py-2 border-b border-gray-100 text-xs whitespace-nowrap">
        {formatCreatedDate(track.createdAt)}
      </td>
      <td className="px-2.5 py-2 border-b border-gray-100 text-xs whitespace-nowrap">
        <span
          className={cn(
            'inline-block text-[10px] font-bold tracking-wide rounded-full px-2 py-0.5 border',
            isPublished
              ? 'bg-green-100 text-green-800 border-green-300'
              : 'bg-gray-100 text-gray-500 border-gray-300',
          )}
        >
          {isPublished ? 'PUBLIC' : 'PRIVATE'}
        </span>
      </td>
      <td className="px-2.5 py-2 border-b border-gray-100 text-xs whitespace-nowrap">
        {Number.isFinite(playCount) ? playCount : ''}
      </td>
    </tr>
  );
}
