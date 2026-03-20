'use client';

import { useState, useEffect, useRef } from 'react';
import type { WaveformData } from '@/lib/types';
import { cdnUrl } from '@/lib/audio-url';

const cache = new Map<string, WaveformData>();

/**
 * Dynamically loads waveform data for a track when it's loaded into a DJ deck.
 * Caches results in memory so repeated loads are instant.
 */
export function useWaveform(
  waveformPath: string | null | undefined,
  hasWaveform: boolean | undefined,
): WaveformData | null {
  const [data, setData] = useState<WaveformData | null>(() => {
    if (waveformPath && hasWaveform && cache.has(waveformPath)) {
      return cache.get(waveformPath)!;
    }
    return null;
  });

  const pathRef = useRef(waveformPath);

  useEffect(() => {
    pathRef.current = waveformPath;

    if (!waveformPath || !hasWaveform) {
      setData(null);
      return;
    }

    // Already cached
    if (cache.has(waveformPath)) {
      setData(cache.get(waveformPath)!);
      return;
    }

    const url = cdnUrl(waveformPath);

    fetch(url)
      .then((res) => {
        if (!res.ok) throw new Error(`${res.status}`);
        return res.json() as Promise<WaveformData>;
      })
      .then((wf) => {
        cache.set(waveformPath, wf);
        // Only update if this is still the current path
        if (pathRef.current === waveformPath) {
          setData(wf);
        }
      })
      .catch(() => {
        // Silently fail — component falls back to fake waveform
      });
  }, [waveformPath, hasWaveform]);

  return data;
}
