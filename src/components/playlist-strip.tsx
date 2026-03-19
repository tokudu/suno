'use client';

import { useMemo, useCallback, useEffect, useState } from 'react';
import useEmblaCarousel from 'embla-carousel-react';
import type { FlattenedTrack, LibraryPlaylist } from '@/lib/types';
import { getTrackImageUrl } from '@/lib/audio-url';
import { cn, hashString } from '@/lib/utils';

const PLAYLIST_SOURCE_GROUPS = ['Collection', 'DJ Sets'];

function stripGroupPrefix(name: string, groupKey: string): string {
  const prefix = `${groupKey} - `;
  return name.startsWith(prefix) ? name.slice(prefix.length) : name;
}

type PlaylistStripProps = {
  playlists: LibraryPlaylist[];
  tracksById: Map<string, FlattenedTrack>;
  selectedId: string;
  onSelect: (id: string) => void;
};

export function PlaylistStrip({ playlists, tracksById, selectedId, onSelect }: PlaylistStripProps) {
  const [emblaRef, emblaApi] = useEmblaCarousel({
    align: 'start',
    containScroll: 'trimSnaps',
    dragFree: true,
    slidesToScroll: 3,
  });

  const [canScrollPrev, setCanScrollPrev] = useState(false);
  const [canScrollNext, setCanScrollNext] = useState(false);

  const onEmblaSelect = useCallback(() => {
    if (!emblaApi) return;
    setCanScrollPrev(emblaApi.canScrollPrev());
    setCanScrollNext(emblaApi.canScrollNext());
  }, [emblaApi]);

  useEffect(() => {
    if (!emblaApi) return;
    onEmblaSelect();
    emblaApi.on('select', onEmblaSelect);
    emblaApi.on('reInit', onEmblaSelect);
    return () => {
      emblaApi.off('select', onEmblaSelect);
      emblaApi.off('reInit', onEmblaSelect);
    };
  }, [emblaApi, onEmblaSelect]);

  const scrollPrev = useCallback(() => emblaApi?.scrollPrev(), [emblaApi]);
  const scrollNext = useCallback(() => emblaApi?.scrollNext(), [emblaApi]);

  const items = useMemo(() => {
    return playlists
      .filter((p) => PLAYLIST_SOURCE_GROUPS.includes(p.groupKey))
      .map((p) => {
        const firstTrackId = p.trackIds[0];
        const firstTrack = firstTrackId ? tracksById.get(firstTrackId) : undefined;
        const imageUrl = firstTrack ? getTrackImageUrl(firstTrack, 'large') : null;
        return {
          id: p.id,
          name: stripGroupPrefix(p.name, p.groupKey),
          trackCount: p.trackCount,
          imageUrl,
          hue: hashString(p.id) % 360,
        };
      });
  }, [playlists, tracksById]);

  return (
    <div className="relative w-full">
      {/* Left arrow */}
      {canScrollPrev && (
        <button
          onClick={scrollPrev}
          className="absolute left-1 top-1/2 -translate-y-1/2 z-10 w-8 h-8 rounded-full bg-black/60 backdrop-blur-sm border border-white/[0.1] text-white/80 hover:text-white hover:bg-black/80 cursor-pointer inline-flex items-center justify-center transition-all shadow-lg"
        >
          <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
            <path d="M8.5 3.5L5 7L8.5 10.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>
      )}

      {/* Embla viewport */}
      <div ref={emblaRef} className="overflow-hidden">
        <div className="flex gap-3">
          {items.map((item) => {
            const active = item.id === selectedId;
            return (
              <button
                key={item.id}
                onClick={() => onSelect(item.id)}
                className={cn(
                  'flex-none w-[100px] sm:w-[130px] rounded-xl overflow-hidden cursor-pointer transition-all duration-150',
                  'border-2',
                  active
                    ? 'border-[#ff2975] shadow-[0_0_16px_rgba(255,41,117,0.3)]'
                    : 'border-transparent hover:border-white/[0.15]',
                )}
              >
                <div className="relative w-full aspect-square bg-white/[0.04]">
                  {item.imageUrl ? (
                    <img
                      src={item.imageUrl}
                      alt=""
                      className="w-full h-full object-cover"
                      loading="lazy"
                    />
                  ) : (
                    <div
                      className="w-full h-full"
                      style={{
                        background: `linear-gradient(135deg, hsl(${item.hue}, 60%, 35%), hsl(${(item.hue + 80) % 360}, 50%, 25%))`,
                      }}
                    />
                  )}
                  <div className="absolute inset-0 bg-gradient-to-t from-black/70 via-black/10 to-transparent" />
                  <div className="absolute inset-x-0 bottom-0 p-2">
                    <div className={cn(
                      'text-[13px] font-semibold leading-tight',
                      active ? 'text-white' : 'text-white/90',
                    )}>
                      {item.name}
                    </div>
                    <div className="text-[10px] text-white/50 mt-0.5">
                      {item.trackCount} tracks
                    </div>
                  </div>
                </div>
              </button>
            );
          })}
        </div>
      </div>

      {/* Right arrow */}
      {canScrollNext && (
        <button
          onClick={scrollNext}
          className="absolute right-1 top-1/2 -translate-y-1/2 z-10 w-8 h-8 rounded-full bg-black/60 backdrop-blur-sm border border-white/[0.1] text-white/80 hover:text-white hover:bg-black/80 cursor-pointer inline-flex items-center justify-center transition-all shadow-lg"
        >
          <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
            <path d="M5.5 3.5L9 7L5.5 10.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>
      )}
    </div>
  );
}
