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
  unlocked: boolean;
  onUnlock: () => void;
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
  className,
}: {
  label: string;
  options: { id: string; name: string }[];
  value: string | null;
  onChange: (id: string | null) => void;
  className?: string;
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
    <div ref={ref} className={cn("relative flex items-center gap-1.5", className)}>
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

function PasswordDialog({ open, onClose, onSuccess }: { open: boolean; onClose: () => void; onSuccess: () => void }) {
  const [password, setPassword] = useState('');
  const [error, setError] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (open) {
      setPassword('');
      setError(false);
      setTimeout(() => inputRef.current?.focus(), 50);
    }
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', handleKey);
    return () => document.removeEventListener('keydown', handleKey);
  }, [open, onClose]);

  if (!open) return null;

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (password === 'whiteboardhero') {
      onSuccess();
      onClose();
    } else {
      setError(true);
    }
  };

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 backdrop-blur-sm" onClick={onClose}>
      <div
        className="bg-[#141420] border border-white/[0.1] rounded-2xl shadow-[0_20px_60px_rgba(0,0,0,0.6)] p-6 w-[340px]"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="text-lg font-bold text-white mb-4">Enter Password</h2>
        <form onSubmit={handleSubmit}>
          <input
            ref={inputRef}
            type="password"
            value={password}
            onChange={(e) => { setPassword(e.target.value); setError(false); }}
            placeholder="Enter password"
            className={cn(
              'w-full rounded-lg px-3 py-2 text-sm bg-white/[0.06] border text-white placeholder-gray-500 outline-none transition-colors',
              error ? 'border-red-500/60' : 'border-white/[0.1] focus:border-[#ff2975]/50',
            )}
          />
          {error && <p className="text-red-400 text-xs mt-1.5">Wrong answer. Try again.</p>}
          <div className="flex gap-2 mt-4">
            <button
              type="button"
              onClick={onClose}
              className="flex-1 rounded-lg px-3 py-2 text-sm text-gray-400 bg-white/[0.06] border border-white/[0.1] hover:bg-white/[0.1] cursor-pointer transition-colors"
            >
              Cancel
            </button>
            <button
              type="submit"
              className="flex-1 rounded-lg px-3 py-2 text-sm font-semibold text-white bg-gradient-to-br from-[#ff2975] to-[#8c1eff] shadow-[0_4px_12px_rgba(255,41,117,0.3)] cursor-pointer transition-opacity hover:opacity-90"
            >
              Unlock
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

export function FilterToolbar({ playlists, filters, onFilterChange, trackCount, unlocked, onUnlock }: FilterToolbarProps) {
  const [dialogOpen, setDialogOpen] = useState(false);

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
    <>
      <div className="flex flex-wrap items-center gap-2 sm:gap-3">
        {FILTER_GROUPS.map((group) => (
          <FilterDropdown
            key={group}
            label={group}
            options={groupedOptions[group] ?? []}
            className="hidden sm:flex first:flex"
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
        <div className="flex items-center gap-2 ml-auto">
          <span className="text-[11px] text-gray-600">{trackCount} tracks</span>
          {!unlocked && (
            <button
              onClick={() => setDialogOpen(true)}
              className="inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-[11px] font-semibold text-white bg-gradient-to-br from-[#ff2975] to-[#8c1eff] shadow-[0_4px_12px_rgba(255,41,117,0.3)] cursor-pointer transition-opacity hover:opacity-90"
            >
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
                <path d="M7 11V7a5 5 0 0 1 10 0v4" />
              </svg>
              Unlock Private Tracks
            </button>
          )}
        </div>
      </div>
      <PasswordDialog open={dialogOpen} onClose={() => setDialogOpen(false)} onSuccess={onUnlock} />
    </>
  );
}
