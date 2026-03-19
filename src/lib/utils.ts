import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function hashString(str: string): number {
  let h = 0;
  for (let i = 0; i < str.length; i++) h = ((h << 5) - h) + str.charCodeAt(i);
  return Math.abs(h);
}

export function badgeColor(label: string): { bg: string; fg: string } {
  const hue = hashString(label) % 360;
  return { bg: `hsla(${hue}, 70%, 50%, 0.15)`, fg: `hsl(${hue}, 60%, 70%)` };
}

const majorMap: Record<string, string> = {
  C: '1d', G: '2d', D: '3d', A: '4d', E: '5d', B: '6d',
  'F#': '7d', Gb: '7d', 'C#': '8d', Db: '8d', 'G#': '9d', Ab: '9d',
  'D#': '10d', Eb: '10d', 'A#': '11d', Bb: '11d', F: '12d',
};
const minorMap: Record<string, string> = {
  A: '1m', E: '2m', B: '3m', 'F#': '4m', Gb: '4m', 'C#': '5m', Db: '5m',
  'G#': '6m', Ab: '6m', 'D#': '7m', Eb: '7m', 'A#': '8m', Bb: '8m',
  F: '9m', C: '10m', G: '11m', D: '12m',
};

export function toOpenKey(musicalKey: string | null): string | null {
  if (!musicalKey) return null;
  const match = String(musicalKey).trim().match(/^([A-G])([#b]?)[\s_-]+(Major|Minor)$/i);
  if (!match) return null;
  const note = match[1].toUpperCase() + (match[2] || '');
  const mode = match[3].toLowerCase() === 'major' ? 'major' : 'minor';
  return mode === 'major' ? (majorMap[note] || null) : (minorMap[note] || null);
}

export function formatDuration(seconds: number | null | undefined): string {
  if (typeof seconds !== 'number' || !Number.isFinite(seconds) || seconds < 0) return '';
  const rounded = Math.round(seconds);
  const m = Math.floor(rounded / 60);
  const s = String(rounded % 60).padStart(2, '0');
  return `${m}:${s}`;
}

export function formatCreatedDate(value: string | null | undefined): string {
  if (!value) return '';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return '';
  return new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', year: 'numeric' }).format(d);
}

export function getTrackDisplayTitle(track: { title?: string | null; id: string }): string {
  return String(track.title || track.id || '');
}

const MAX_TAG_LENGTH = 32;

function cleanTag(tag: string): string {
  // Strip bracket metadata like [genre: electronic]
  let cleaned = tag.replace(/^\[.*?:\s*/, '').replace(/\]$/, '');
  // Strip leading emoji
  cleaned = cleaned.replace(/^[\p{Emoji}\p{Emoji_Component}\s]+/u, '');
  cleaned = cleaned.trim();
  // Truncate with ellipsis if still too long
  if (cleaned.length > MAX_TAG_LENGTH) {
    cleaned = cleaned.slice(0, MAX_TAG_LENGTH - 1).trimEnd() + '…';
  }
  return cleaned;
}

export function parseTags(track: {
  metadata?: Record<string, unknown>;
  tags?: string | null;
}): string[] {
  const meta = track.metadata as Record<string, unknown> | undefined;
  const innerMeta = meta?.metadata as Record<string, unknown> | undefined;
  const rawTags = (innerMeta?.tags as string) || (meta?.tags as string) || track.tags || '';
  return String(rawTags)
    // Split on commas, bullets, pipes, semicolons, and newlines
    .split(/[,•|;\n]+/)
    .map(cleanTag)
    .filter((s) => s.length > 1)
    // Deduplicate (case-insensitive)
    .filter((s, i, arr) => arr.findIndex((t) => t.toLowerCase() === s.toLowerCase()) === i)
    .slice(0, 12);
}
