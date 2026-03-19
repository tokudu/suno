'use client';

import { useState, useEffect, useMemo } from 'react';
import type { FlattenedTrack, LibraryData, LibraryPlaylist } from '@/lib/types';
import { cdnUrl } from '@/lib/audio-url';

export function useLibrary() {
  const [data, setData] = useState<LibraryData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch(cdnUrl('library.json'))
      .then((res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return res.json();
      })
      .then((json: LibraryData) => {
        setData(json);
        setLoading(false);
      })
      .catch((err) => {
        setError(err instanceof Error ? err.message : String(err));
        setLoading(false);
      });
  }, []);

  const tracksById = useMemo(() => {
    if (!data) return new Map<string, FlattenedTrack>();
    return new Map(data.tracks.map((t) => [t.id, t]));
  }, [data]);

  return {
    tracks: data?.tracks ?? [],
    playlists: data?.playlists ?? [],
    tracksById,
    loading,
    error,
  };
}
