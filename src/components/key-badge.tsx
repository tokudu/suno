'use client';

import { badgeColor, toOpenKey } from '@/lib/utils';

export function KeyBadge({ musicalKey }: { musicalKey: string | null }) {
  const openKey = toOpenKey(musicalKey);
  if (!openKey) return null;
  const { bg, fg } = badgeColor(`openkey:${openKey}`);
  return (
    <span
      className="inline-block rounded-full px-2 py-0.5 text-[11px] font-semibold font-mono border border-white/[0.1]"
      style={{ background: bg, color: fg }}
    >
      {openKey}
    </span>
  );
}
