'use client';

import { useMemo } from 'react';
import type { LibraryPlaylist } from '@/lib/types';
import { PLAYLIST_GROUP_ORDER } from '@/lib/constants';
import { cn } from '@/lib/utils';
import { Particles } from './ui/particles';

type SidebarProps = {
  playlists: LibraryPlaylist[];
  selectedId: string;
  onSelect: (id: string) => void;
};

function stripGroupPrefix(name: string, groupKey: string): string {
  if (!groupKey || groupKey === 'Collection') return name;
  const prefix = `${groupKey} - `;
  return name.startsWith(prefix) ? name.slice(prefix.length) : name;
}

export function Sidebar({ playlists, selectedId, onSelect }: SidebarProps) {
  const grouped = useMemo(() => {
    const map = new Map<string, LibraryPlaylist[]>();
    for (const p of playlists) {
      const key = p.groupKey || 'Other';
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(p);
    }
    return map;
  }, [playlists]);

  const allTracks = playlists.find((p) => p.id === 'collection-all-tracks');

  const groups = useMemo(() => {
    return [...grouped.keys()]
      .filter((g) => g !== 'Collection')
      .sort((a, b) => {
        const ai = PLAYLIST_GROUP_ORDER.indexOf(a);
        const bi = PLAYLIST_GROUP_ORDER.indexOf(b);
        const ar = ai >= 0 ? ai : 999;
        const br = bi >= 0 ? bi : 999;
        if (ar !== br) return ar - br;
        return a.localeCompare(b);
      });
  }, [grouped]);

  const renderItem = (p: LibraryPlaylist) => {
    const displayName = stripGroupPrefix(p.name, p.groupKey);
    const active = p.id === selectedId;
    return (
      <button
        key={p.id}
        onClick={() => onSelect(p.id)}
        className={cn(
          'flex w-full items-center justify-between gap-2 rounded-lg px-2 py-1.5 text-left text-sm cursor-pointer',
          active ? 'bg-blue-600 text-white' : 'hover:bg-white/[0.08] text-gray-50',
        )}
      >
        <span className="truncate">{displayName}</span>
        <span
          className={cn(
            'min-w-[28px] text-center text-[11px] rounded-full px-2 py-px',
            active ? 'bg-white/[0.28]' : 'bg-white/[0.16] text-gray-50',
          )}
        >
          {p.trackCount}
        </span>
      </button>
    );
  };

  return (
    <aside className="sidebar-bg text-gray-50 p-4 overflow-auto border-r border-white/[0.08] relative">
      <Particles
        className="absolute inset-0 z-0 pointer-events-none"
        quantity={40}
        size={0.3}
        color="#f97316"
        staticity={80}
        ease={80}
      />
      <div className="relative z-10">
      <h2 className="mt-0 mb-3 text-lg font-bold">Playlists</h2>
      {allTracks && renderItem(allTracks)}
      {groups.map((group) => (
        <div key={group}>
          <div className="mt-4 mb-2 text-[10px] font-normal tracking-widest uppercase text-gray-400">
            {group}
          </div>
          {grouped
            .get(group)!
            .slice()
            .sort((a, b) => a.name.localeCompare(b.name))
            .map(renderItem)}
        </div>
      ))}
      </div>
    </aside>
  );
}
