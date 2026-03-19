'use client';

import { useMemo, useState, useRef, useEffect, useCallback } from 'react';
import type { LibraryPlaylist } from '@/lib/types';
import { cn } from '@/lib/utils';

const FILTER_GROUPS = ['Genre', 'Energy', 'Mood', 'BPM', 'Key'] as const;
type Filters = Record<string, string | null>;

type FilterToolbarProps = {
  playlists: LibraryPlaylist[];
  filters: Filters;
  onFilterChange: (groupKey: string, playlistId: string | null) => void;
  trackCount: number;
};

function stripGroupPrefix(name: string, groupKey: string): string {
  const prefix = `${groupKey} - `;
  return name.startsWith(prefix) ? name.slice(prefix.length) : name;
}

function FilterDropdown({
  label,
  options,
  value,
  onChange,
}: {
  label: string;
  options: { id: string; name: string }[];
  value: string | null;
  onChange: (id: string | null) => void;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  const selectedLabel = options.find((o) => o.id === value)?.name ?? 'All';

  const handleClickOutside = useCallback((e: MouseEvent) => {
    if (ref.current && !ref.current.contains(e.target as Node)) {
      setOpen(false);
    }
  }, []);

  useEffect(() => {
    if (!open) return;
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [open, handleClickOutside]);

  return (
    <div ref={ref} className="relative flex items-center gap-1.5">
      <span className="text-[10px] font-semibold uppercase tracking-wider text-gray-500 whitespace-nowrap">
        {label}
      </span>
      <button
        onClick={() => setOpen((o) => !o)}
        className={cn(
          'inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs cursor-pointer transition-colors',
          'bg-white/[0.06] border border-white/[0.1] text-gray-300',
          'hover:bg-white/[0.1] hover:border-white/[0.16]',
          open && 'bg-white/[0.1] border-white/[0.2]',
          value && 'border-[#ff2975]/30 text-gray-200',
        )}
      >
        <span className="max-w-[120px] truncate">{selectedLabel}</span>
        <svg
          width="10"
          height="10"
          viewBox="0 0 10 10"
          fill="none"
          className={cn('transition-transform duration-150 flex-none', open && 'rotate-180')}
        >
          <path d="M2.5 3.75L5 6.25L7.5 3.75" stroke="currentColor" strokeWidth="1.25" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>
      {open && (
        <div className="absolute top-full left-0 mt-1.5 z-50 min-w-[160px] max-h-[280px] overflow-auto rounded-xl border border-white/[0.1] bg-[#141420]/95 backdrop-blur-xl shadow-[0_16px_48px_rgba(0,0,0,0.5)] py-1">
          <button
            onClick={() => { onChange(null); setOpen(false); }}
            className={cn(
              'w-full text-left px-3 py-1.5 text-xs cursor-pointer transition-colors',
              !value
                ? 'text-white bg-white/[0.08]'
                : 'text-gray-400 hover:text-gray-200 hover:bg-white/[0.06]',
            )}
          >
            All
          </button>
          {options.map((o) => (
            <button
              key={o.id}
              onClick={() => { onChange(o.id); setOpen(false); }}
              className={cn(
                'w-full text-left px-3 py-1.5 text-xs cursor-pointer transition-colors',
                value === o.id
                  ? 'text-white bg-[#ff2975]/20'
                  : 'text-gray-400 hover:text-gray-200 hover:bg-white/[0.06]',
              )}
            >
              {o.name}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

export function FilterToolbar({ playlists, filters, onFilterChange, trackCount }: FilterToolbarProps) {
  const groupedOptions = useMemo(() => {
    const map: Record<string, { id: string; name: string }[]> = {};
    for (const group of FILTER_GROUPS) {
      map[group] = playlists
        .filter((p) => p.groupKey === group)
        .map((p) => ({ id: p.id, name: stripGroupPrefix(p.name, group) }))
        .sort((a, b) => a.name.localeCompare(b.name));
    }
    return map;
  }, [playlists]);

  const activeCount = Object.values(filters).filter(Boolean).length;

  return (
    <div className="flex flex-wrap items-center gap-2 sm:gap-3">
      {FILTER_GROUPS.map((group) => (
        <FilterDropdown
          key={group}
          label={group}
          options={groupedOptions[group] ?? []}
          value={filters[group] ?? null}
          onChange={(id) => onFilterChange(group, id)}
        />
      ))}
      {activeCount > 0 && (
        <button
          onClick={() => {
            for (const group of FILTER_GROUPS) {
              onFilterChange(group, null);
            }
          }}
          className="text-[11px] text-gray-500 hover:text-gray-300 cursor-pointer transition-colors ml-1"
        >
          Clear filters
        </button>
      )}
      <span className="text-[11px] text-gray-600 ml-auto">{trackCount} tracks</span>
    </div>
  );
}
