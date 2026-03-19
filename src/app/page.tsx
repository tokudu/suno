'use client';

import { useState, useCallback, useRef, useMemo } from 'react';
import { useLibrary } from '@/hooks/use-library';
import { useAudioPlayer } from '@/hooks/use-audio-player';
import { usePlayback } from '@/hooks/use-playback';
import { TrackTable } from '@/components/track-table';
import { FlickeringGrid } from '@/components/ui/flickering-grid';

type Filters = Record<string, string | null>;

export default function Home() {
  const { tracks, playlists, tracksById, loading, error } = useLibrary();
  const [selectedPlaylistId, setSelectedPlaylistId] = useState('collection-all-tracks');
  const [filters, setFilters] = useState<Filters>({});

  const handleFilterChange = useCallback((groupKey: string, playlistId: string | null) => {
    setFilters((prev) => ({ ...prev, [groupKey]: playlistId }));
  }, []);

  // For "all tracks", order positions by play count descending
  const allTrackIdsByPlays = useMemo(() => {
    return [...tracks]
      .sort((a, b) => {
        const pa = Number((a.metadata as Record<string, unknown>)?.play_count) || 0;
        const pb = Number((b.metadata as Record<string, unknown>)?.play_count) || 0;
        return pb - pa;
      })
      .map((t) => t.id);
  }, [tracks]);

  // Start with the selected playlist's track IDs, then intersect with active filters
  const filteredTrackIds = useMemo(() => {
    const isAllTracks = selectedPlaylistId === 'collection-all-tracks';
    let baseIds: string[];
    if (isAllTracks) {
      baseIds = allTrackIdsByPlays;
    } else {
      const basePlaylist = playlists.find((p) => p.id === selectedPlaylistId);
      baseIds = basePlaylist ? basePlaylist.trackIds : allTrackIdsByPlays;
    }

    const activeFilterIds = Object.values(filters).filter(Boolean) as string[];
    if (activeFilterIds.length === 0) {
      return baseIds;
    }
    const filterSets = activeFilterIds.map((pid) => {
      const pl = playlists.find((p) => p.id === pid);
      return new Set(pl?.trackIds ?? []);
    });
    return baseIds.filter((id) => filterSets.every((s) => s.has(id)));
  }, [tracks, playlists, selectedPlaylistId, filters, allTrackIdsByPlays]);

  // Use a ref-based callback to break the circular dependency between audio player and playback
  const advanceRef = useRef<() => void>(() => {});
  const onEnded = useCallback(() => advanceRef.current(), []);

  const audioPlayer = useAudioPlayer(onEnded);

  const pb = usePlayback(
    tracksById,
    audioPlayer.play,
    audioPlayer.pause,
    audioPlayer.resume,
    audioPlayer.state.playing,
  );

  // Keep the ref in sync
  advanceRef.current = pb.advance;

  const handlePlayPause = useCallback(() => {
    if (!pb.currentTrackId) return;
    if (audioPlayer.state.playing) {
      audioPlayer.pause();
    } else {
      audioPlayer.resume();
    }
  }, [pb.currentTrackId, audioPlayer.state.playing, audioPlayer.pause, audioPlayer.resume]);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-screen text-gray-500 text-sm">
        Loading library...
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex items-center justify-center h-screen text-red-500 text-sm">
        Error loading library: {error}
      </div>
    );
  }

  return (
    <>
      <FlickeringGrid
        className="fixed inset-0 z-0 opacity-60"
        squareSize={8}
        gridGap={6}
        color="#FF00FF"
        maxOpacity={0.5}
        flickerChance={0.1}
      />
      <div className="relative z-10 min-h-screen w-full max-w-full overflow-hidden">
        <main className="p-2 sm:p-5 pb-8 max-w-[1600px] mx-auto w-full">
          <TrackTable
            tracks={tracks}
            playlists={playlists}
            tracksById={tracksById}
            filteredTrackIds={filteredTrackIds}
            selectedPlaylistId={selectedPlaylistId}
            onPlaylistChange={setSelectedPlaylistId}
            filters={filters}
            onFilterChange={handleFilterChange}
            currentTrackId={pb.currentTrackId}
            audioPlaying={audioPlayer.state.playing}
            onTogglePlay={pb.togglePlayback}
            playing={audioPlayer.state.playing}
            currentTime={audioPlayer.state.currentTime}
            duration={audioPlayer.state.duration}
            queue={pb.queue}
            queueIndex={pb.queueIndex}
            queueSourcePlaylistId={pb.queueSourcePlaylistId}
            onPlayPause={handlePlayPause}
            onPrev={pb.playPrev}
            onNext={pb.playNext}
            onSeek={audioPlayer.seek}
            onPlayQueueIndex={pb.playQueueIndex}
          />
        </main>
      </div>
    </>
  );
}
