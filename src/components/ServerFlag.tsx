import { cn } from "@/lib/utils"

export default function ServerFlag({ country_code, className }: { country_code: string; className?: string }) {
  if (!country_code) return null

  const code = country_code.toLowerCase()

  return (
    <span className={cn("inline-flex items-center text-[12px] text-muted-foreground", className)}>
      <img
        src={`https://flagcdn.com/${code}.svg`}
        alt={country_code.toUpperCase()}
        loading="lazy"
        className="inline-block h-[1em] w-auto rounded-[1px] object-cover"
      />
    </span>
  )
}
