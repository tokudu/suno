'use client';

import { useMemo, useState, useCallback, useRef } from 'react';
import {
  useReactTable,
  getCoreRowModel,
  getSortedRowModel,
  getFilteredRowModel,
  createColumnHelper,
  flexRender,
  type SortingState,
  type ColumnFiltersState,
} from '@tanstack/react-table';
import type { FlattenedTrack, LibraryPlaylist } from '@/lib/types';
import { toOpenKey, parseTags, formatDuration, formatCreatedDate, getTrackDisplayTitle } from '@/lib/utils';
import { getAudioSrc, getTrackImageUrl } from '@/lib/audio-url';
import { cn } from '@/lib/utils';
import { Badge } from './badge';
import { KeyBadge } from './key-badge';
import { GradientText } from './ui/gradient-text';
import { FilterToolbar } from './filter-toolbar';
import { PlaylistStrip } from './playlist-strip';
import { Player } from './player';
import { DjPlayer } from './dj-player';
import type { useDjMode } from '@/hooks/use-dj-mode';

type TrackTableProps = {
  tracks: FlattenedTrack[];
  playlists: LibraryPlaylist[];
  tracksById: Map<string, FlattenedTrack>;
  filteredTrackIds: string[];
  selectedPlaylistId: string;
  onPlaylistChange: (playlistId: string) => void;
  filters: Record<string, string | null>;
  onFilterChange: (groupKey: string, playlistId: string | null) => void;
  currentTrackId: string | null;
  audioPlaying: boolean;
  onTogglePlay: (track: FlattenedTrack, visiblePlayable: FlattenedTrack[], playlistId: string) => void;
  playing: boolean;
  currentTime: number;
  duration: number;
  queue: string[];
  queueIndex: number;
  queueSourcePlaylistId: string | null;
  onPlayPause: () => void;
  onPrev: () => void;
  onNext: () => void;
  onSeek: (time: number) => void;
  onPlayQueueIndex: (index: number) => void;
  unlocked: boolean;
  onUnlock: () => void;
  djMode: boolean;
  djActiveDeck: 'A' | 'B';
  djDeckATrackId: string | null;
  djDeckBTrackId: string | null;
  onDjToggle: () => void;
  djState: ReturnType<typeof useDjMode>;
};

function hashHue(id: string): number {
  let hash = 0;
  for (let i = 0; i < id.length; i++) {
    hash = id.charCodeAt(i) + ((hash << 5) - hash);
  }
  return Math.abs(hash) % 360;
}

const columnHelper = createColumnHelper<FlattenedTrack & { _position: number | null }>();

const VISIBLE_TAG_COUNT = 3;

// Columns hidden at various breakpoints for responsive layout
const HIDDEN_ON_MOBILE: Set<string> = new Set(['length', 'bpm', 'key', 'tags', 'created', 'published', 'plays']);
const HIDDEN_ON_TABLET: Set<string> = new Set(['tags', 'created', 'published', 'plays']);

function responsiveColumnClass(columnId: string): string {
  if (HIDDEN_ON_MOBILE.has(columnId) && HIDDEN_ON_TABLET.has(columnId)) {
    return 'hidden lg:table-cell';
  }
  if (HIDDEN_ON_MOBILE.has(columnId)) {
    return 'hidden md:table-cell';
  }
  return '';
}

function CollapsibleTags({ tags }: { tags: string[] }) {
  const [expanded, setExpanded] = useState(false);
  if (tags.length === 0) return null;

  const visible = expanded ? tags : tags.slice(0, VISIBLE_TAG_COUNT);
  const remaining = tags.length - VISIBLE_TAG_COUNT;

  return (
    <div className="flex flex-wrap gap-1.5">
      {visible.map((tag) => (
        <Badge key={tag} label={tag} />
      ))}
      {remaining > 0 && (
        <button
          onClick={(e) => {
            e.stopPropagation();
            setExpanded(!expanded);
          }}
          className="inline-block text-[10px] font-bold tracking-wide rounded-full px-2 py-0.5 border bg-white/[0.08] text-gray-400 border-white/[0.12] cursor-pointer hover:bg-white/[0.14] transition-colors"
        >
          {expanded ? 'show less' : `+ ${remaining} more`}
        </button>
      )}
    </div>
  );
}

export function TrackTable({
  tracks,
  playlists,
  tracksById,
  filteredTrackIds,
  selectedPlaylistId,
  onPlaylistChange,
  filters,
  onFilterChange,
  currentTrackId,
  audioPlaying,
  onTogglePlay,
  playing,
  currentTime,
  duration,
  queue,
  queueIndex,
  queueSourcePlaylistId,
  onPlayPause,
  onPrev,
  onNext,
  onSeek,
  onPlayQueueIndex,
  unlocked,
  onUnlock,
  djMode,
  djActiveDeck,
  djDeckATrackId,
  djDeckBTrackId,
  onDjToggle,
  djState,
}: TrackTableProps) {
  const [sorting, setSorting] = useState<SortingState>([{ id: 'position', desc: false }]);
  const [columnFilters, setColumnFilters] = useState<ColumnFiltersState>([]);
  const visiblePlayableRef = useRef<FlattenedTrack[]>([]);

  const positionMap = useMemo(
    () => new Map(filteredTrackIds.map((id, idx) => [id, idx + 1])),
    [filteredTrackIds],
  );

  // Filter to matching tracks and attach position
  const data = useMemo(() => {
    const idSet = new Set(filteredTrackIds);
    return tracks
      .filter((t) => idSet.has(t.id))
      .map((t) => ({ ...t, _position: positionMap.get(t.id) ?? null }));
  }, [tracks, filteredTrackIds, positionMap]);

  const columns = useMemo(
    () => [
      columnHelper.accessor('_position', {
        id: 'position',
        header: '#',
        cell: (info) => info.getValue() ?? '',
        sortingFn: (a, b) => (a.original._position ?? Infinity) - (b.original._position ?? Infinity),
      }),
      columnHelper.display({
        id: 'player',
        header: 'Player',
        cell: ({ row }) => {
          const track = row.original;
          const isCurrent = currentTrackId === track.id;
          const isPlaying = isCurrent && audioPlaying;
          const imageUrl = getTrackImageUrl(track);
          return (
            <div className="relative w-[38px] h-[38px] flex-none">
              {imageUrl ? (
                <img
                  src={imageUrl}
                  alt=""
                  className="w-[38px] h-[38px] rounded-lg object-cover shadow-sm"
                  loading="lazy"
                />
              ) : (
                <div
                  className="w-[38px] h-[38px] rounded-lg"
                  style={{
                    background: `linear-gradient(135deg, hsl(${hashHue(track.id)}, 80%, 65%), hsl(${(hashHue(track.id) + 60) % 360}, 80%, 55%))`,
                  }}
                />
              )}
              <button
                onClick={() => onTogglePlay(track, visiblePlayableRef.current, 'filtered')}
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
          );
        },
        enableSorting: true,
        sortingFn: (a, b) => (a.original.hasMp3 ? 1 : 0) - (b.original.hasMp3 ? 1 : 0),
      }),
      columnHelper.accessor((row) => getTrackDisplayTitle(row), {
        id: 'title',
        header: 'Title',
        cell: (info) => info.getValue(),
      }),
      columnHelper.accessor('duration', {
        id: 'length',
        header: 'Length',
        cell: (info) => formatDuration(info.getValue()),
        sortingFn: (a, b) => (a.original.duration ?? -1) - (b.original.duration ?? -1),
      }),
      columnHelper.accessor('bpm', {
        id: 'bpm',
        header: 'BPM',
        cell: (info) => {
          const v = info.getValue();
          return typeof v === 'number' ? Math.round(v) : '';
        },
        sortingFn: (a, b) => (a.original.bpm ?? -1) - (b.original.bpm ?? -1),
      }),
      columnHelper.accessor('musicalKey', {
        id: 'key',
        header: 'Key',
        cell: (info) => <KeyBadge musicalKey={info.getValue()} />,
        sortingFn: (a, b) =>
          (toOpenKey(a.original.musicalKey) || '').localeCompare(toOpenKey(b.original.musicalKey) || ''),
      }),
      columnHelper.accessor((row) => parseTags(row).join(','), {
        id: 'tags',
        header: 'Tags',
        cell: ({ row }) => <CollapsibleTags tags={parseTags(row.original)} />,
      }),
      columnHelper.accessor('createdAt', {
        id: 'created',
        header: 'Created',
        cell: (info) => formatCreatedDate(info.getValue()),
        sortingFn: (a, b) => {
          const msA = Date.parse(a.original.createdAt || '');
          const msB = Date.parse(b.original.createdAt || '');
          return (Number.isFinite(msA) ? msA : -1) - (Number.isFinite(msB) ? msB : -1);
        },
      }),
      columnHelper.accessor('isPublic', {
        id: 'published',
        header: 'Published',
        cell: (info) => {
          const isPublished = info.getValue() === true;
          return (
            <span
              className={cn(
                'inline-block text-[10px] font-bold tracking-wide rounded-full px-2 py-0.5 border',
                isPublished
                  ? 'bg-green-500/[0.15] text-green-400 border-green-500/[0.3]'
                  : 'bg-white/[0.06] text-gray-500 border-white/[0.1]',
              )}
            >
              {isPublished ? 'PUBLIC' : 'PRIVATE'}
            </span>
          );
        },
        sortingFn: (a, b) => (a.original.isPublic ? 1 : 0) - (b.original.isPublic ? 1 : 0),
        filterFn: (row, _columnId, filterValue) => {
          if (!filterValue) return true;
          return row.original.isPublic === true;
        },
      }),
      columnHelper.accessor(
        (row) => {
          const n = Number((row.metadata as Record<string, unknown>)?.play_count);
          return Number.isFinite(n) ? n : null;
        },
        {
          id: 'plays',
          header: 'Plays',
          cell: (info) => {
            const v = info.getValue();
            return v != null ? v : '';
          },
          sortingFn: (a, b) => {
            const na = Number((a.original.metadata as Record<string, unknown>)?.play_count);
            const nb = Number((b.original.metadata as Record<string, unknown>)?.play_count);
            return (Number.isFinite(na) ? na : -1) - (Number.isFinite(nb) ? nb : -1);
          },
        },
      ),
    ],
    [currentTrackId, audioPlaying, onTogglePlay],
  );

  const table = useReactTable({
    data,
    columns,
    state: { sorting, columnFilters },
    onSortingChange: setSorting,
    onColumnFiltersChange: setColumnFilters,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
  });


  const { rows } = table.getRowModel();

  const visiblePlayable = useMemo(
    () =>
      rows
        .map((r) => r.original)
        .filter((t) => getAudioSrc(t.mp3Path, t.hasMp3) !== null),
    [rows],
  );
  visiblePlayableRef.current = visiblePlayable;

  const handleSort = useCallback(
    (columnId: string) => {
      setSorting((prev) => {
        const existing = prev.find((s) => s.id === columnId);
        if (existing) {
          return [{ id: columnId, desc: !existing.desc }];
        }
        return [{ id: columnId, desc: columnId === 'created' }];
      });
    },
    [],
  );

  return (
    <div className="grid grid-rows-[auto_auto_auto_1fr_auto] w-full max-w-full overflow-hidden bg-white/[0.04] border border-white/[0.08] rounded-2xl sm:rounded-3xl shadow-[0_0_0_1px_rgba(255,255,255,0.02),0_20px_45px_rgba(0,0,0,0.3)] backdrop-blur-md pt-3 sm:pt-4" style={{ maxHeight: 'calc(100vh - 24px)', minHeight: 0 }}>
      {/* Header */}
      <div className="flex items-center justify-between px-3 sm:px-4 mb-3 sm:mb-4">
        <h3 className="text-xl sm:text-2xl font-bold m-0 tracking-tight flex items-center gap-2">
          <span className="text-white">TOKUDU</span>
          <GradientText>SUNO</GradientText>
        </h3>
      </div>

      {/* Playlist strip */}
      <div className="px-3 sm:px-4 mb-3 sm:mb-4 overflow-hidden">
        <PlaylistStrip
          playlists={playlists}
          tracksById={tracksById}
          selectedId={selectedPlaylistId}
          onSelect={onPlaylistChange}
        />
      </div>

      {/* Filter toolbar */}
      <div className="px-3 sm:px-4 mb-3 sm:mb-4">
        <FilterToolbar
          playlists={playlists}
          filters={filters}
          onFilterChange={onFilterChange}
          trackCount={rows.length}
          unlocked={unlocked}
          onUnlock={onUnlock}
        />
      </div>

      {/* Table */}
      <div className="overflow-auto min-h-0">
        <table className="w-full border-collapse">
          <thead>
            <tr>
              {table.getHeaderGroups()[0].headers.map((header) => (
                <th
                  key={header.id}
                  onClick={() => handleSort(header.id)}
                  className={cn(
                    'px-2 sm:px-2.5 py-2 sm:py-2.5 border-b border-white/[0.06] text-left text-[11px] font-semibold uppercase tracking-wider text-gray-500 whitespace-nowrap cursor-pointer select-none',
                    responsiveColumnClass(header.id),
                  )}
                >
                  <span className="inline-flex items-center gap-1.5">
                    {flexRender(header.column.columnDef.header, header.getContext())}
                    <span
                      className={`text-[13px] leading-none ${
                        header.column.getIsSorted() ? 'text-[#ff2975]' : 'text-gray-600'
                      }`}
                    >
                      {{ asc: '▴', desc: '▾' }[header.column.getIsSorted() as string] ?? ''}
                    </span>
                  </span>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => {
              const track = row.original;
              const isCurrent = currentTrackId === track.id;
              const isDeckA = djMode && djDeckATrackId === track.id;
              const isDeckB = djMode && djDeckBTrackId === track.id;
              return (
                <tr
                  key={row.id}
                  draggable={djMode && track.hasMp3}
                  onDragStart={
                    djMode && track.hasMp3
                      ? (e) => {
                          e.dataTransfer.setData('application/x-track-id', track.id);
                          e.dataTransfer.effectAllowed = 'copy';
                        }
                      : undefined
                  }
                  className={cn(
                    'group/row transition-colors duration-150',
                    isDeckA
                      ? 'bg-[#ff2975]/[0.1]'
                      : isDeckB
                        ? 'bg-[#00d4ff]/[0.1]'
                        : isCurrent
                          ? 'bg-[#ff2975]/[0.1]'
                          : 'hover:bg-white/[0.04]',
                    track.isPublic !== true && 'opacity-90',
                    djMode && track.hasMp3 && 'cursor-grab active:cursor-grabbing',
                  )}
                >
                  {row.getVisibleCells().map((cell) => (
                    <td
                      key={cell.id}
                      className={cn(
                        'px-2 sm:px-2.5 py-2 border-b border-white/[0.04] text-xs whitespace-nowrap text-gray-300',
                        cell.column.id === 'position' && 'text-left font-mono text-gray-500',
                        cell.column.id === 'player' && 'py-1.5',
                        cell.column.id === 'title' && 'text-sm font-semibold whitespace-normal break-all',
                        cell.column.id === 'length' && 'font-mono',
                        cell.column.id === 'bpm' && 'font-mono',
                        cell.column.id === 'tags' && 'whitespace-normal',
                        responsiveColumnClass(cell.column.id),
                      )}
                    >
                      {flexRender(cell.column.columnDef.cell, cell.getContext())}
                    </td>
                  ))}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* Player footer */}
      {djMode ? (
        <DjPlayer
          tracksById={tracksById}
          deckA={djState.deckA}
          deckB={djState.deckB}
          crossfader={djState.crossfader}
          onCrossfaderChange={djState.setCrossfader}
          activeDeck={djState.activeDeck}
          onActiveDeckChange={djState.setActiveDeck}
          onClose={onDjToggle}
          onLoadToDeck={(deck, trackId) => {
            const track = tracksById.get(trackId);
            if (track) djState.loadToDeck(deck, track);
          }}
          autoMix={djState.autoMix}
          onAutoMixChange={djState.setAutoMix}
          volumeA={djState.volumeA}
          volumeB={djState.volumeB}
          onVolumeAChange={djState.setVolumeA}
          onVolumeBChange={djState.setVolumeB}
        />
      ) : (
        <Player
          currentTrackId={currentTrackId}
          tracksById={tracksById}
          playing={playing}
          currentTime={currentTime}
          duration={duration}
          queue={queue}
          queueIndex={queueIndex}
          queueSourcePlaylistId={queueSourcePlaylistId}
          playlists={playlists}
          onPlayPause={onPlayPause}
          onPrev={onPrev}
          onNext={onNext}
          onSeek={onSeek}
          onPlayQueueIndex={onPlayQueueIndex}
          onDjToggle={onDjToggle}
        />
      )}
    </div>
  );
}
