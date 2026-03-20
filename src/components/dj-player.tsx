'use client';

import { useMemo, useCallback, useState, useRef, useEffect } from 'react';
import type { FlattenedTrack } from '@/lib/types';
import { formatDuration } from '@/lib/utils';
import { getTrackImageUrl } from '@/lib/audio-url';
import { getTrackDisplayTitle } from '@/lib/utils';
import { cn } from '@/lib/utils';
import { KeyBadge } from './key-badge';
import { useWaveform } from '@/hooks/use-waveform';

export type DeckInfo = {
  trackId: string | null;
  playing: boolean;
  currentTime: number;
  duration: number;
  seek: (time: number) => void;
  playPause: () => void;
};

type DjPlayerProps = {
  tracksById: Map<string, FlattenedTrack>;
  deckA: DeckInfo;
  deckB: DeckInfo;
  crossfader: number;
  onCrossfaderChange: (value: number) => void;
  activeDeck: 'A' | 'B';
  onActiveDeckChange: (deck: 'A' | 'B') => void;
  onLoadToDeck: (deck: 'A' | 'B', trackId: string) => void;
  volumeA: number;
  volumeB: number;
  onVolumeAChange: (value: number) => void;
  onVolumeBChange: (value: number) => void;
};

/* ── Fake waveform fallback seeded by track ID ── */
function fakeWaveformBars(trackId: string | null): number[] {
  const result: number[] = [];
  let hash = 5381;
  const seed = trackId || 'empty';
  for (let i = 0; i < 64; i++) {
    hash = ((hash << 5) + hash + seed.charCodeAt(i % seed.length)) | 0;
    const base = 0.15 + (Math.abs(hash) % 85) / 100;
    const envelope = 0.6 + 0.4 * Math.sin((i / 64) * Math.PI);
    result.push(base * envelope);
  }
  return result;
}

/* ── Waveform with real frequency-band display ── */
function Waveform({
  track,
  progress,
  accentColor,
}: {
  track: FlattenedTrack | null;
  progress: number;
  accentColor: string;
}) {
  const waveformData = useWaveform(track?.waveformPath, track?.hasWaveform);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  // Fake fallback bars (memoized)
  const fakeBars = useMemo(() => fakeWaveformBars(track?.id ?? null), [track?.id]);

  // Draw real waveform on canvas
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !waveformData) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const dpr = window.devicePixelRatio || 1;
    const rect = canvas.getBoundingClientRect();
    canvas.width = rect.width * dpr;
    canvas.height = rect.height * dpr;
    ctx.scale(dpr, dpr);

    const w = rect.width;
    const h = rect.height;
    const { low, mid, high, pointCount } = waveformData;
    const barW = w / pointCount;
    const playedX = progress * w;

    ctx.clearRect(0, 0, w, h);

    // Draw stacked frequency bands for each point
    for (let i = 0; i < pointCount; i++) {
      const x = i * barW;
      const isPast = x + barW <= playedX;
      const alpha = isPast ? 1.0 : 0.25;

      // Stack: low on bottom, mid in middle, high on top
      const lowH = low[i] * h * 0.4;
      const midH = mid[i] * h * 0.35;
      const highH = high[i] * h * 0.25;
      const totalH = lowH + midH + highH;

      // Low band (deep magenta)
      ctx.fillStyle = `rgba(180,30,90,${alpha})`;
      ctx.fillRect(x, h - lowH, barW - 0.5, lowH);

      // Mid band (hot pink)
      ctx.fillStyle = `rgba(255,41,117,${alpha})`;
      ctx.fillRect(x, h - lowH - midH, barW - 0.5, midH);

      // High band (lavender/purple)
      ctx.fillStyle = `rgba(200,100,255,${alpha})`;
      ctx.fillRect(x, h - totalH, barW - 0.5, highH);
    }

    // Playhead line
    if (progress > 0 && progress < 1) {
      ctx.fillStyle = 'rgba(255,255,255,0.9)';
      ctx.fillRect(playedX - 0.5, 0, 1, h);
    }
  }, [waveformData, progress]);

  // If no real waveform data, show fake bars
  if (!waveformData) {
    return (
      <div className="flex items-end gap-[1px] h-10 w-full">
        {fakeBars.map((height, i) => {
          const filled = i / fakeBars.length < progress;
          return (
            <div
              key={i}
              className="flex-1 rounded-[1px] transition-colors duration-75"
              style={{
                height: `${height * 100}%`,
                background: filled ? accentColor : 'rgba(255,255,255,0.1)',
              }}
            />
          );
        })}
      </div>
    );
  }

  return (
    <canvas
      ref={canvasRef}
      className="w-full h-10 rounded-sm"
      style={{ imageRendering: 'pixelated' }}
    />
  );
}

/* ── Scrolling waveform background (Traktor-style) ── */

/** Linearly interpolate a waveform array at a fractional index */
function sampleAt(arr: number[], idx: number): number {
  if (idx <= 0) return arr[0] ?? 0;
  if (idx >= arr.length - 1) return arr[arr.length - 1] ?? 0;
  const lo = Math.floor(idx);
  const frac = idx - lo;
  return arr[lo] * (1 - frac) + arr[lo + 1] * frac;
}

// Fallback window if BPM unknown
const SCROLL_SECONDS_DEFAULT = 30;
// Beats to show each side of playhead
const SCROLL_BEATS_HALF = 32;

function ScrollingWaveform({
  track,
  progress,
  accentColor,
}: {
  track: FlattenedTrack | null;
  progress: number;
  accentColor: string;
}) {
  const waveformData = useWaveform(track?.waveformPath, track?.hasWaveform);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !waveformData) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const dpr = window.devicePixelRatio || 1;
    const rect = canvas.getBoundingClientRect();
    const w = rect.width;
    const h = rect.height;
    if (w === 0 || h === 0) return;

    canvas.width = w * dpr;
    canvas.height = h * dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);

    const { low, mid, high, pointCount, duration } = waveformData;
    const centerY = h / 2;

    // Window size: 32 beats each side based on BPM, fallback to fixed seconds
    const bpm = track?.bpm;
    const windowSeconds = bpm && bpm > 0
      ? (SCROLL_BEATS_HALF * 2 * 60) / bpm
      : SCROLL_SECONDS_DEFAULT;

    // Map time window to data points
    const pointsPerSec = pointCount / duration;
    const currentTime = progress * duration;
    const startPt = (currentTime - windowSeconds / 2) * pointsPerSec;
    const totalPts = windowSeconds * pointsPerSec;

    // Draw one vertical line per pixel
    for (let px = 0; px < w; px++) {
      const ptIdx = startPt + (px / w) * totalPts;
      if (ptIdx < 0 || ptIdx >= pointCount) continue;

      const l = sampleAt(low, ptIdx);
      const m = sampleAt(mid, ptIdx);
      const hi = sampleAt(high, ptIdx);

      const isPast = px < w / 2;
      const baseAlpha = isPast ? 0.9 : 0.45;

      // Draw mirrored from center — layered bands (pink/purple theme)
      // Low (bottom layer, deep magenta/red)
      const lowHalf = l * centerY * 0.95;
      ctx.fillStyle = `rgba(180,30,90,${baseAlpha * 0.5})`;
      ctx.fillRect(px, centerY - lowHalf, 1, lowHalf * 2);

      // Mid (main layer, hot pink — dominant)
      const midHalf = (l * 0.3 + m) * centerY * 0.85;
      ctx.fillStyle = `rgba(255,41,117,${baseAlpha})`;
      ctx.fillRect(px, centerY - midHalf, 1, midHalf * 2);

      // High (top accents, bright pink/lavender)
      const highHalf = (m * 0.15 + hi) * centerY * 0.55;
      ctx.fillStyle = `rgba(200,100,255,${baseAlpha * 0.6})`;
      ctx.fillRect(px, centerY - highHalf, 1, highHalf * 2);
    }

    // Playhead line (center)
    const cx = w / 2;
    ctx.fillStyle = `${accentColor}99`;
    ctx.fillRect(cx - 1, 0, 2, h);

    // Subtle glow
    const glow = ctx.createLinearGradient(cx - 16, 0, cx + 16, 0);
    glow.addColorStop(0, 'transparent');
    glow.addColorStop(0.5, `${accentColor}12`);
    glow.addColorStop(1, 'transparent');
    ctx.fillStyle = glow;
    ctx.fillRect(cx - 16, 0, 32, h);
  }, [waveformData, progress, accentColor]);

  if (!waveformData) return null;

  return (
    <canvas
      ref={canvasRef}
      className="absolute inset-0 w-full h-full rounded-xl pointer-events-none opacity-10"
    />
  );
}

/* ── Vinyl record with artwork ── */
function Vinyl({
  track,
  playing,
  accentColor,
}: {
  track: FlattenedTrack | null;
  playing: boolean;
  accentColor: string;
}) {
  const imageUrl = track ? getTrackImageUrl(track, 'small') : null;

  return (
    <div className="relative w-[100px] h-[100px] flex-none">
      {/* Glow effect */}
      <div
        className="absolute inset-[-6px] rounded-full blur-lg opacity-30 transition-opacity duration-300"
        style={{
          background: accentColor,
          opacity: playing ? 0.35 : 0.1,
        }}
      />
      {/* Vinyl disc */}
      <div
        className={cn(
          'absolute inset-0 rounded-full animate-vinyl-spin',
          !playing && 'paused',
        )}
        style={{
          background: `
            repeating-radial-gradient(
              circle at center,
              #111 0px,
              #111 2px,
              rgba(255,255,255,0.04) 2px,
              rgba(255,255,255,0.04) 3px
            )
          `,
          boxShadow: `
            inset 0 0 0 1px rgba(255,255,255,0.06),
            0 4px 20px rgba(0,0,0,0.6)
          `,
        }}
      >
        {/* Label area / artwork */}
        <div className="absolute inset-0 m-auto w-[40px] h-[40px] rounded-full overflow-hidden border-2 border-white/10">
          {imageUrl ? (
            <img
              src={imageUrl}
              alt=""
              className="w-full h-full object-cover"
            />
          ) : (
            <div
              className="w-full h-full"
              style={{
                background: `linear-gradient(135deg, ${accentColor}66, ${accentColor}22)`,
              }}
            />
          )}
        </div>
        {/* Center spindle */}
        <div className="absolute inset-0 m-auto w-[6px] h-[6px] rounded-full bg-white/40" />
      </div>
    </div>
  );
}

/* ── Individual deck ── */
export function Deck({
  label,
  deck,
  track,
  accentColor,
  isActive,
  onActivate,
  onDrop: onDropTrack,
}: {
  label?: string;
  deck: DeckInfo;
  track: FlattenedTrack | null;
  accentColor: string;
  isActive: boolean;
  onActivate: () => void;
  onDrop: (trackId: string) => void;
}) {
  const progress = deck.duration > 0 ? deck.currentTime / deck.duration : 0;
  const remaining = deck.duration > 0 ? Math.max(0, deck.duration - deck.currentTime) : 0;
  const [dragOver, setDragOver] = useState(false);

  const handleWaveformClick = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      if (!deck.duration || deck.duration <= 0) return;
      const rect = e.currentTarget.getBoundingClientRect();
      const ratio = rect.width > 0 ? (e.clientX - rect.left) / rect.width : 0;
      deck.seek(Math.max(0, Math.min(deck.duration, ratio * deck.duration)));
    },
    [deck],
  );

  const handleDragOver = useCallback((e: React.DragEvent) => {
    if (e.dataTransfer.types.includes('application/x-track-id')) {
      e.preventDefault();
      e.dataTransfer.dropEffect = 'copy';
      setDragOver(true);
    }
  }, []);

  const handleDragLeave = useCallback(() => {
    setDragOver(false);
  }, []);

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      setDragOver(false);
      const trackId = e.dataTransfer.getData('application/x-track-id');
      if (trackId) {
        onDropTrack(trackId);
      }
    },
    [onDropTrack],
  );

  return (
    <div
      className={cn(
        'flex-1 rounded-xl p-3 transition-all duration-200 cursor-pointer border relative overflow-hidden',
        dragOver
          ? 'bg-white/[0.12] border-dashed'
          : isActive
            ? 'bg-white/[0.06] border-white/[0.12]'
            : 'bg-white/[0.02] border-transparent hover:bg-white/[0.04]',
      )}
      style={dragOver ? { borderColor: accentColor, boxShadow: `inset 0 0 24px ${accentColor}22` } : undefined}
      onClick={onActivate}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      {/* Scrolling waveform background */}
      <ScrollingWaveform track={track} progress={progress} accentColor={accentColor} />

      {/* Deck header */}
      <div className="relative z-[1] flex items-center gap-2 mb-3">
        <span
          className="text-[10px] font-black tracking-[0.2em] px-2 py-0.5 rounded"
          style={{
            background: `${accentColor}22`,
            color: accentColor,
            border: `1px solid ${accentColor}44`,
          }}
        >
          {label ? `DECK ${label}` : 'NOW PLAYING'}
        </span>
        {isActive && !!label && (
          <span className="text-[9px] uppercase tracking-wider text-white/40">
            active
          </span>
        )}
      </div>

      {/* Vinyl + track info */}
      <div className="relative z-[1] flex items-center gap-3 mb-3">
        <div className="hidden sm:block">
          <Vinyl track={track} playing={deck.playing} accentColor={accentColor} />
        </div>
        <div className="flex-1 min-w-0">
          <div className="text-sm font-bold truncate text-white mb-1">
            {track ? getTrackDisplayTitle(track) : 'No track loaded'}
          </div>
          {track && (
            <div className="flex items-center gap-2 text-[11px] text-white/50">
              {track.bpm && (
                <span className="font-mono" style={{ color: accentColor }}>
                  {Math.round(track.bpm)} BPM
                </span>
              )}
              <KeyBadge musicalKey={track.musicalKey} />
            </div>
          )}
          {/* Play/Pause */}
          <button
            onClick={(e) => {
              e.stopPropagation();
              deck.playPause();
            }}
            disabled={!track}
            className={cn(
              'mt-2 w-9 h-9 rounded-full inline-flex items-center justify-center text-sm transition-all duration-150',
              'disabled:opacity-30 disabled:cursor-not-allowed',
            )}
            style={{
              background: track
                ? `linear-gradient(135deg, ${accentColor}, ${accentColor}aa)`
                : 'rgba(255,255,255,0.08)',
              boxShadow: track && deck.playing
                ? `0 4px 16px ${accentColor}55`
                : 'none',
            }}
          >
            {deck.playing ? '⏸' : '▶'}
          </button>
        </div>
      </div>

      {/* Waveform */}
      <div className="relative z-[1] cursor-pointer" onClick={handleWaveformClick}>
        <Waveform
          track={track}
          progress={progress}
          accentColor={accentColor}
        />
      </div>

      {/* Time display */}
      <div className="relative z-[1] flex justify-between mt-1.5 text-[10px] font-mono text-white/40">
        <span>{formatDuration(deck.currentTime) || '0:00'}</span>
        <span>{deck.duration > 0 ? `-${formatDuration(remaining)}` : '0:00'}</span>
      </div>
    </div>
  );
}

/* ── Main DJ Player ── */
export function DjPlayer({
  tracksById,
  deckA,
  deckB,
  crossfader,
  onCrossfaderChange,
  activeDeck,
  onActiveDeckChange,
  onLoadToDeck,
  volumeA,
  volumeB,
  onVolumeAChange,
  onVolumeBChange,
}: DjPlayerProps) {
  const trackA = deckA.trackId ? tracksById.get(deckA.trackId) ?? null : null;
  const trackB = deckB.trackId ? tracksById.get(deckB.trackId) ?? null : null;

  return (
    <div className="text-gray-50">
      {/* Decks + Mixer */}
      <div className="flex flex-col sm:flex-row gap-3 p-3">
        {/* Deck A */}
        <Deck
          label="A"
          deck={deckA}
          track={trackA}
          accentColor="#ff2975"
          isActive={activeDeck === 'A'}
          onActivate={() => onActiveDeckChange('A')}
          onDrop={(trackId) => onLoadToDeck('A', trackId)}
        />

        {/* Center Mixer */}
        <div className="hidden sm:flex flex-col items-center justify-between gap-3 w-[120px] flex-none py-1">
          {/* LOAD A / LOAD B toggle */}
          <div className="flex items-center rounded-full bg-white/[0.06] border border-white/[0.1] p-0.5">
            <button
              onClick={() => onActiveDeckChange('A')}
              className={cn(
                'text-[10px] font-bold tracking-wider px-3 py-1 rounded-full transition-all duration-150 whitespace-nowrap',
                activeDeck === 'A'
                  ? 'bg-[#ff2975]/20 text-[#ff2975]'
                  : 'text-white/40 hover:text-white/60',
              )}
            >
              LOAD A
            </button>
            <button
              onClick={() => onActiveDeckChange('B')}
              className={cn(
                'text-[10px] font-bold tracking-wider px-3 py-1 rounded-full transition-all duration-150 whitespace-nowrap',
                activeDeck === 'B'
                  ? 'bg-[#00d4ff]/20 text-[#00d4ff]'
                  : 'text-white/40 hover:text-white/60',
              )}
            >
              LOAD B
            </button>
          </div>

          {/* BPM match indicator */}
          {trackA?.bpm && trackB?.bpm && (
            <div className="text-center">
              <div className="text-[9px] uppercase tracking-wider text-white/30 mb-1">
                BPM Δ
              </div>
              <div
                className={cn(
                  'text-xs font-mono font-bold',
                  Math.abs(trackA.bpm - trackB.bpm) < 2
                    ? 'text-green-400'
                    : Math.abs(trackA.bpm - trackB.bpm) < 5
                      ? 'text-yellow-400'
                      : 'text-red-400',
                )}
              >
                {Math.abs(trackA.bpm - trackB.bpm).toFixed(1)}
              </div>
            </div>
          )}

          {/* Channel faders with VU meters */}
          <div className="flex items-end gap-2 justify-center">
            <VuMeter
              level={Math.cos(crossfader * Math.PI / 2) * volumeA}
              playing={deckA.playing}
              color="#ff2975"
            />
            <ChannelFader label="A" value={volumeA} onChange={onVolumeAChange} color="#ff2975" />
            <ChannelFader label="B" value={volumeB} onChange={onVolumeBChange} color="#00d4ff" />
            <VuMeter
              level={Math.sin(crossfader * Math.PI / 2) * volumeB}
              playing={deckB.playing}
              color="#00d4ff"
            />
          </div>

          {/* Crossfader */}
          <div className="w-full flex flex-col items-center gap-1.5">
            <span className="text-[8px] uppercase tracking-[0.15em] text-white/25">
              X-FADE
            </span>
            <input
              type="range"
              min="0"
              max="1"
              step="0.01"
              value={crossfader}
              onChange={(e) => onCrossfaderChange(parseFloat(e.target.value))}
              className="dj-crossfader w-full"
            />
            <div className="flex justify-between w-full text-[8px] text-white/20">
              <span>A</span>
              <span>B</span>
            </div>
          </div>
        </div>

        {/* Deck B */}
        <Deck
          label="B"
          deck={deckB}
          track={trackB}
          accentColor="#00d4ff"
          isActive={activeDeck === 'B'}
          onActivate={() => onActiveDeckChange('B')}
          onDrop={(trackId) => onLoadToDeck('B', trackId)}
        />
      </div>

    </div>
  );
}

/* ── Channel Fader (vertical slider like a real DJ mixer) ── */
function ChannelFader({
  label,
  value,
  onChange,
  color,
}: {
  label: string;
  value: number;
  onChange: (v: number) => void;
  color: string;
}) {
  return (
    <div className="flex flex-col items-center gap-1">
      <span className="text-[8px] uppercase tracking-[0.15em] text-white/25">
        {label}
      </span>
      {/* Fader channel slot */}
      <div
        className="relative h-[100px] w-[22px] rounded-[4px] flex items-center justify-center"
        style={{
          background: 'linear-gradient(180deg, #1a1a22 0%, #111118 100%)',
          boxShadow:
            'inset 0 1px 3px rgba(0,0,0,0.6), inset 0 0 0 1px rgba(255,255,255,0.05)',
        }}
      >
        {/* Level fill */}
        <div
          className="absolute bottom-[2px] left-[2px] right-[2px] rounded-[2px] transition-[height] duration-75 pointer-events-none"
          style={{
            height: `${value * 96}px`,
            background: `linear-gradient(180deg, ${color} 0%, ${color}44 100%)`,
            opacity: 0.3,
          }}
        />
        {/* Actual range input */}
        <input
          type="range"
          min="0"
          max="1"
          step="0.01"
          value={value}
          onChange={(e) => onChange(parseFloat(e.target.value))}
          className="dj-channel-fader h-[92px] relative z-10"
        />
      </div>
    </div>
  );
}

/* ── VU Meter (LED-style level indicator) ── */
const VU_SEGMENTS = 12;

function VuMeter({
  level,
  playing,
  color,
}: {
  level: number;
  playing: boolean;
  color: string;
}) {
  const displayLevel = playing ? level : 0;
  const litCount = Math.round(displayLevel * VU_SEGMENTS);

  return (
    <div className="flex flex-col-reverse gap-[2px] h-[100px] justify-center">
      {Array.from({ length: VU_SEGMENTS }, (_, i) => {
        const lit = i < litCount;
        // Top segments = red (clip), upper-mid = yellow, rest = channel color
        const segColor =
          i >= VU_SEGMENTS - 2
            ? '#ff3333'
            : i >= VU_SEGMENTS - 4
              ? '#ffcc00'
              : color;
        return (
          <div
            key={i}
            className="w-[6px] rounded-[1px] transition-opacity duration-75"
            style={{
              height: `${(100 - (VU_SEGMENTS - 1) * 2) / VU_SEGMENTS}%`,
              background: segColor,
              opacity: lit ? 0.9 : 0.1,
            }}
          />
        );
      })}
    </div>
  );
}
