const CDN_BASE = process.env.NEXT_PUBLIC_CDN_URL || '';

/**
 * Resolve a data-relative path to a full URL.
 * - Dev: empty CDN_BASE → serves from public/data/ symlink (e.g. /data/file.mp3)
 * - Prod: CDN_BASE = R2 bucket URL (e.g. https://suno-audio.tokudu.com/file.mp3)
 */
export function cdnUrl(dataPath: string): string {
  const key = dataPath.replace(/^data\//, '');
  if (CDN_BASE) {
    return `${CDN_BASE}/${key}`;
  }
  return `/data/${key}`;
}

export function getAudioSrc(mp3Path: string | null, hasMp3: boolean): string | null {
  if (!mp3Path || !hasMp3) return null;
  return cdnUrl(mp3Path);
}

/**
 * Get track image URL. Prefers local thumbnails (96x96 webp) for 'small' size
 * to avoid decoding 2000px+ images at tiny display sizes.
 * Falls back to Suno CDN metadata URLs if no local image/thumb exists.
 */
export function getTrackImageUrl(
  track: {
    thumbPath?: string | null;
    imagePath?: string | null;
    hasThumb?: boolean;
    hasImage?: boolean;
    metadata?: Record<string, unknown>;
  },
  size: 'small' | 'large' = 'small',
): string | null {
  // Prefer local files served via CDN/public
  if (size === 'small' && track.thumbPath && track.hasThumb) {
    return cdnUrl(track.thumbPath);
  }
  if (track.imagePath && track.hasImage) {
    return cdnUrl(track.imagePath);
  }

  // Fall back to Suno CDN URLs from metadata
  const meta = track.metadata as Record<string, unknown> | undefined;
  if (size === 'large') {
    return (meta?.image_large_url as string) || (meta?.image_url as string) || null;
  }
  return (meta?.image_url as string) || (meta?.image_large_url as string) || null;
}
