'use client';

import { badgeColor } from '@/lib/utils';

export function Badge({ label }: { label: string }) {
  const { bg, fg } = badgeColor(label);
  return (
    <span
      className="inline-block rounded-full px-2 py-0.5 text-[11px] border border-white/[0.1]"
      style={{ background: bg, color: fg }}
    >
      {label}
    </span>
  );
}
