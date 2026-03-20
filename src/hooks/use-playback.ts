'use client';

import { useState, useCallback, useRef } from 'react';
import type { FlattenedTrack } from '@/lib/types';
import { getAudioSrc } from '@/lib/audio-url';

export type PlaybackState = {
  currentTrackId: string | null;
  queue: string[];
  queueIndex: number;
  queueSourcePlaylistId: string | null;
  continuousPlayback: boolean;
};

export function usePlayback(
  tracksById: Map<string, FlattenedTrack>,
  audioPlay: (src: string) => void,
  audioPause: () => void,
  audioResume: () => void,
  audioPlaying: boolean,
) {
  const [state, setState] = useState<PlaybackState>({
    currentTrackId: null,
    queue: [],
    queueIndex: -1,
    queueSourcePlaylistId: null,
    continuousPlayback: true,
  });

  // Keep a ref for the onEnded callback to avoid stale closures
  const stateRef = useRef(state);
  stateRef.current = state;

  const playTrackAtIndex = useCallback(
    (queue: string[], index: number, sourcePlaylistId: string | null) => {
      const trackId = queue[index];
      const track = tracksById.get(trackId ?? '');
      if (!track) return;
      const src = getAudioSrc(track.mp3Path, track.hasMp3);
      if (!src) return;
      setState((prev) => ({
        ...prev,
        currentTrackId: track.id,
        queue,
        queueIndex: index,
        queueSourcePlaylistId: sourcePlaylistId,
      }));
      audioPlay(src);
    },
    [tracksById, audioPlay],
  );

  const buildQueueAndPlay = useCallback(
    (track: FlattenedTrack, visiblePlayableTracks: FlattenedTrack[], playlistId: string) => {
      const newQueue = visiblePlayableTracks.map((t) => t.id);
      const index = newQueue.indexOf(track.id);
      if (index === -1) return;
      playTrackAtIndex(newQueue, index, playlistId);
    },
    [playTrackAtIndex],
  );

  const togglePlayback = useCallback(
    (track: FlattenedTrack, visiblePlayableTracks: FlattenedTrack[], playlistId: string) => {
      const s = stateRef.current;
      if (s.currentTrackId === track.id && s.queue[s.queueIndex] === track.id) {
        if (audioPlaying) {
          audioPause();
        } else {
          audioResume();
        }
        return;
      }
      buildQueueAndPlay(track, visiblePlayableTracks, playlistId);
    },
    [audioPlaying, audioPause, audioResume, buildQueueAndPlay],
  );

  const playPrev = useCallback(() => {
    const s = stateRef.current;
    if (s.queueIndex <= 0) return;
    playTrackAtIndex(s.queue, s.queueIndex - 1, s.queueSourcePlaylistId);
  }, [playTrackAtIndex]);

  const playNext = useCallback(() => {
    const s = stateRef.current;
    if (s.queueIndex < 0 || s.queueIndex >= s.queue.length - 1) return;
    playTrackAtIndex(s.queue, s.queueIndex + 1, s.queueSourcePlaylistId);
  }, [playTrackAtIndex]);

  const playQueueIndex = useCallback(
    (index: number) => {
      const s = stateRef.current;
      playTrackAtIndex(s.queue, index, s.queueSourcePlaylistId);
    },
    [playTrackAtIndex],
  );

  const advance = useCallback(() => {
    const s = stateRef.current;
    if (s.continuousPlayback && s.queueIndex >= 0 && s.queueIndex < s.queue.length - 1) {
      playTrackAtIndex(s.queue, s.queueIndex + 1, s.queueSourcePlaylistId);
    } else {
      setState((prev) => ({ ...prev, currentTrackId: null }));
    }
  }, [playTrackAtIndex]);

  const toggleContinuousPlayback = useCallback(() => {
    setState((prev) => ({ ...prev, continuousPlayback: !prev.continuousPlayback }));
  }, []);

  const setContinuousPlayback = useCallback((value: boolean) => {
    setState((prev) => ({ ...prev, continuousPlayback: value }));
  }, []);

  return {
    ...state,
    togglePlayback,
    buildQueueAndPlay,
    playPrev,
    playNext,
    playQueueIndex,
    advance,
    toggleContinuousPlayback,
    setContinuousPlayback,
  };
}
