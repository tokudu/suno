'use client';

import { useState, useCallback, useEffect, useRef } from 'react';
import type { FlattenedTrack } from '@/lib/types';
import { getAudioSrc } from '@/lib/audio-url';
import { useAudioPlayer } from './use-audio-player';

const CROSSFADE_SECONDS = 6;

export function getInitialDjModeActive() {
  return false;
}

export function useDjMode(tracksById: Map<string, FlattenedTrack>, masterVolume: number = 1) {
  const [active, setActive] = useState(getInitialDjModeActive);
  const [deckATrackId, setDeckATrackId] = useState<string | null>(null);
  const [deckBTrackId, setDeckBTrackId] = useState<string | null>(null);
  const [crossfader, setCrossfader] = useState(0.5);
  const [activeDeck, setActiveDeck] = useState<'A' | 'B'>('A');
  const [autoMix, setAutoMix] = useState(true);
  const [leadDeck, setLeadDeck] = useState<'A' | 'B'>('A');
  const [volumeA, setVolumeA] = useState(1);
  const [volumeB, setVolumeB] = useState(1);

  // ── Refs to avoid stale closures in callbacks/intervals ──
  const crossfaderRef = useRef(crossfader);
  const leadDeckRef = useRef(leadDeck);
  const autoMixRef = useRef(autoMix);
  const deckATrackIdRef = useRef(deckATrackId);
  const deckBTrackIdRef = useRef(deckBTrackId);
  const volumeARef = useRef(volumeA);
  const volumeBRef = useRef(volumeB);

  crossfaderRef.current = crossfader;
  leadDeckRef.current = leadDeck;
  autoMixRef.current = autoMix;
  deckATrackIdRef.current = deckATrackId;
  deckBTrackIdRef.current = deckBTrackId;
  volumeARef.current = volumeA;
  volumeBRef.current = volumeB;

  // Auto mix queue
  const queueRef = useRef<string[]>([]);
  const queueIndexRef = useRef(0); // index of NEXT track to load
  const crossfadeAnimRef = useRef<number | null>(null);

  // ── Stable onEnded callbacks via refs ──
  const deckAEndedRef = useRef<() => void>(() => {});
  const deckBEndedRef = useRef<() => void>(() => {});

  const deckAOnEnded = useCallback(() => deckAEndedRef.current(), []);
  const deckBOnEnded = useCallback(() => deckBEndedRef.current(), []);

  const deckAPlayer = useAudioPlayer(deckAOnEnded);
  const deckBPlayer = useAudioPlayer(deckBOnEnded);

  // Refs for player state (needed in intervals)
  const deckAStateRef = useRef(deckAPlayer.state);
  const deckBStateRef = useRef(deckBPlayer.state);
  deckAStateRef.current = deckAPlayer.state;
  deckBStateRef.current = deckBPlayer.state;

  const masterVolumeRef = useRef(masterVolume);
  masterVolumeRef.current = masterVolume;

  // ── Combined volume: per-deck volume × crossfader curve × master ──
  useEffect(() => {
    const xA = Math.cos(crossfader * Math.PI / 2);
    const xB = Math.sin(crossfader * Math.PI / 2);
    deckAPlayer.setVolume(xA * volumeA * masterVolume);
    deckBPlayer.setVolume(xB * volumeB * masterVolume);
  }, [crossfader, volumeA, volumeB, masterVolume, deckAPlayer.setVolume, deckBPlayer.setVolume]);

  // Helper to recompute and apply volumes from current refs
  const applyVolumes = useCallback(() => {
    const cf = crossfaderRef.current;
    const xA = Math.cos(cf * Math.PI / 2);
    const xB = Math.sin(cf * Math.PI / 2);
    deckAPlayer.setVolume(xA * volumeARef.current * masterVolumeRef.current);
    deckBPlayer.setVolume(xB * volumeBRef.current * masterVolumeRef.current);
  }, [deckAPlayer.setVolume, deckBPlayer.setVolume]);

  // ── Core deck loading ──
  const loadToDeckInternal = useCallback(
    (deck: 'A' | 'B', track: FlattenedTrack) => {
      const src = getAudioSrc(track.mp3Path, track.hasMp3);
      if (!src) return;
      if (deck === 'A') {
        setDeckATrackId(track.id);
        deckAPlayer.play(src);
      } else {
        setDeckBTrackId(track.id);
        deckBPlayer.play(src);
      }
      // Re-apply volumes after loading (new audio element resets to 1.0)
      requestAnimationFrame(applyVolumes);
    },
    [deckAPlayer.play, deckBPlayer.play, applyVolumes],
  );

  // ── Cancel crossfade animation ──
  const cancelCrossfadeAnim = useCallback(() => {
    if (crossfadeAnimRef.current !== null) {
      cancelAnimationFrame(crossfadeAnimRef.current);
      crossfadeAnimRef.current = null;
    }
  }, []);

  // ── Start crossfade to the opposite deck ──
  const startCrossfadeRef = useRef<() => void>(() => {});

  startCrossfadeRef.current = () => {
    if (crossfadeAnimRef.current !== null) return; // already in progress

    const nextId = queueRef.current[queueIndexRef.current];
    if (!nextId) return; // no more tracks
    const nextTrack = tracksById.get(nextId);
    if (!nextTrack) return;

    const currentLead = leadDeckRef.current;
    const targetDeck: 'A' | 'B' = currentLead === 'A' ? 'B' : 'A';
    const targetCrossfader = targetDeck === 'B' ? 1 : 0;

    // Load and play on the target deck
    loadToDeckInternal(targetDeck, nextTrack);
    queueIndexRef.current++;
    setLeadDeck(targetDeck);
    setActiveDeck(targetDeck);

    // Animate crossfader
    const startValue = crossfaderRef.current;
    const startTime = performance.now();
    const durationMs = CROSSFADE_SECONDS * 1000;

    function animate(now: number) {
      const elapsed = now - startTime;
      const t = Math.min(1, elapsed / durationMs);
      // Ease in-out quadratic
      const eased = t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
      const value = startValue + (targetCrossfader - startValue) * eased;
      setCrossfader(value);

      if (t < 1) {
        crossfadeAnimRef.current = requestAnimationFrame(animate);
      } else {
        crossfadeAnimRef.current = null;
      }
    }

    crossfadeAnimRef.current = requestAnimationFrame(animate);
  };

  // ── onEnded handlers ──
  deckAEndedRef.current = () => {
    if (!autoMixRef.current) return;
    // If A just ended and crossfade didn't happen (short track), snap to B
    if (leadDeckRef.current === 'A') {
      // Try to start next track on B
      const nextId = queueRef.current[queueIndexRef.current];
      if (nextId) {
        const nextTrack = tracksById.get(nextId);
        if (nextTrack) {
          loadToDeckInternal('B', nextTrack);
          queueIndexRef.current++;
          setLeadDeck('B');
          setActiveDeck('B');
          cancelCrossfadeAnim();
          setCrossfader(1);
        }
      }
    }
    // If A ended and B is lead (normal crossfade completed), nothing to do
  };

  deckBEndedRef.current = () => {
    if (!autoMixRef.current) return;
    if (leadDeckRef.current === 'B') {
      const nextId = queueRef.current[queueIndexRef.current];
      if (nextId) {
        const nextTrack = tracksById.get(nextId);
        if (nextTrack) {
          loadToDeckInternal('A', nextTrack);
          queueIndexRef.current++;
          setLeadDeck('A');
          setActiveDeck('A');
          cancelCrossfadeAnim();
          setCrossfader(0);
        }
      }
    }
  };

  // ── Monitor playback for auto crossfade trigger ──
  useEffect(() => {
    if (!autoMix) return;

    const interval = setInterval(() => {
      if (crossfadeAnimRef.current !== null) return; // already crossfading

      const lead = leadDeckRef.current;
      const state = lead === 'A' ? deckAStateRef.current : deckBStateRef.current;

      if (
        state.playing &&
        state.duration > 0 &&
        state.duration - state.currentTime < CROSSFADE_SECONDS &&
        state.currentTime > 0 // avoid triggering before playback really starts
      ) {
        startCrossfadeRef.current();
      }
    }, 300);

    return () => clearInterval(interval);
  }, [autoMix]);

  // ── Cleanup animation on unmount or autoMix off ──
  useEffect(() => {
    if (!autoMix) {
      cancelCrossfadeAnim();
    }
  }, [autoMix, cancelCrossfadeAnim]);

  // ── Public methods ──

  const loadToDeck = useCallback(
    (deck: 'A' | 'B', track: FlattenedTrack) => {
      loadToDeckInternal(deck, track);
    },
    [loadToDeckInternal],
  );

  const loadToActiveDeck = useCallback(
    (track: FlattenedTrack) => {
      loadToDeckInternal(activeDeck, track);
    },
    [activeDeck, loadToDeckInternal],
  );

  /** Start auto mix: load track on the active deck, build queue from visiblePlayable */
  const startWithTrack = useCallback(
    (track: FlattenedTrack, visiblePlayable: FlattenedTrack[]) => {
      // Cancel any in-progress crossfade
      cancelCrossfadeAnim();

      const queue = visiblePlayable
        .filter((t) => getAudioSrc(t.mp3Path, t.hasMp3) !== null)
        .map((t) => t.id);
      const idx = queue.indexOf(track.id);

      queueRef.current = queue;
      queueIndexRef.current = idx >= 0 ? idx + 1 : 1;

      const deck = activeDeck;
      const otherPlayer = deck === 'A' ? deckBPlayer : deckAPlayer;
      const otherSetTrackId = deck === 'A' ? setDeckBTrackId : setDeckATrackId;

      // Load onto the active deck, snap crossfader
      loadToDeckInternal(deck, track);
      setCrossfader(deck === 'A' ? 0 : 1);
      setLeadDeck(deck);

      // Stop the other deck
      otherPlayer.stop();
      otherSetTrackId(null);
    },
    [cancelCrossfadeAnim, loadToDeckInternal, activeDeck, deckAPlayer, deckBPlayer],
  );

  const toggleDeckPlayPause = useCallback(
    (deck: 'A' | 'B') => {
      const player = deck === 'A' ? deckAPlayer : deckBPlayer;
      const trackId = deck === 'A' ? deckATrackIdRef.current : deckBTrackIdRef.current;
      if (!trackId) return;
      if (player.state.playing) {
        player.pause();
      } else {
        player.resume();
      }
    },
    [deckAPlayer, deckBPlayer],
  );

  const close = useCallback(() => {
    deckAPlayer.pause();
    deckBPlayer.pause();
    cancelCrossfadeAnim();
    setActive(false);
  }, [deckAPlayer.pause, deckBPlayer.pause, cancelCrossfadeAnim]);

  const open = useCallback(() => {
    setActive(true);
  }, []);

  /** Called when user manually drags crossfader — cancels auto animation */
  const onCrossfaderManual = useCallback(
    (value: number) => {
      cancelCrossfadeAnim();
      setCrossfader(value);
    },
    [cancelCrossfadeAnim],
  );

  return {
    active,
    open,
    close,
    activeDeck,
    setActiveDeck,
    crossfader,
    setCrossfader: onCrossfaderManual,
    loadToDeck,
    loadToActiveDeck,
    startWithTrack,
    toggleDeckPlayPause,
    autoMix,
    setAutoMix,
    leadDeck,
    volumeA,
    setVolumeA,
    volumeB,
    setVolumeB,
    deckA: {
      trackId: deckATrackId,
      playing: deckAPlayer.state.playing,
      currentTime: deckAPlayer.state.currentTime,
      duration: deckAPlayer.state.duration,
      seek: deckAPlayer.seek,
      playPause: () => toggleDeckPlayPause('A'),
    },
    deckB: {
      trackId: deckBTrackId,
      playing: deckBPlayer.state.playing,
      currentTime: deckBPlayer.state.currentTime,
      duration: deckBPlayer.state.duration,
      seek: deckBPlayer.seek,
      playPause: () => toggleDeckPlayPause('B'),
    },
  };
}
