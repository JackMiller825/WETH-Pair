"use client"

import Link from "next/link"
import { usePathname } from "next/navigation"

const LINKS = [
  ["/", "Dashboard"],
  ["/pairs", "New Pairs"],
  ["/lp-burns", "🔥 LP Burn Watch"],
  ["/trends", "Trends"],
  ["/narratives", "Narratives"],
  ["/news", "News → Tokens"],
  ["/tokens", "Token Explorer"],
  ["/alerts", "Alerts"],
] as const

export function SiteNav() {
  const pathname = usePathname()
  return (
    <header className="border-b border-foreground/10">
      <div className="mx-auto flex w-full max-w-6xl flex-col gap-3 px-4 py-4 sm:px-6">
        <Link href="/" className="text-sm font-semibold tracking-tight">WETH live pairs</Link>
        <nav className="flex gap-2 overflow-x-auto text-sm">
          {LINKS.map(([href, label]) => {
            const active = href === "/" ? pathname === "/" : pathname === href || pathname.startsWith(`${href}/`)
            return (
              <Link key={href} href={href} className={`shrink-0 rounded-full px-3 py-1 ${active ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-muted"}`}>
                {label}
              </Link>
            )
          })}
        </nav>
      </div>
    </header>
  )
}
