import { cn } from '@/lib/utils'

export function GradientText({
  children,
  className,
}: {
  className?: string
  children: React.ReactNode
}) {
  return (
    <span
      className={cn(
        'bg-gradient-to-b from-[#ffd319] via-[#ff2975] to-[#8c1eff] bg-clip-text text-transparent',
        className,
      )}
    >
      {children}
    </span>
  )
}
