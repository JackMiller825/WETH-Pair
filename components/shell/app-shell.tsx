"use client"

import { useEffect, useMemo, useState, type ReactNode } from "react"
import Link from "next/link"
import { usePathname, useRouter } from "next/navigation"
import { Bell, Flame, LayoutDashboard, Menu, Monitor, Moon, Newspaper, Search, Sun, TrendingUp, Waypoints, X, Zap } from "lucide-react"
import { applyTheme, isThemeId, type ThemeId } from "@/lib/theme"
import { ago, eventsOf } from "@/lib/lp/monitor"
import { useLpMonitor } from "@/components/lp/monitor-context"
import { parseIdentity } from "@/lib/narrative/text"
import { CONCEPTS } from "@/lib/narrative/lexicon"

const LINKS = [
  { href: "/", label: "Dashboard", icon: LayoutDashboard },
  { href: "/pairs", label: "New Pairs", icon: Zap },
  { href: "/lp-burns", label: "LP Burn Watch", icon: Flame },
  { href: "/trends", label: "Trends", icon: TrendingUp },
  { href: "/narratives", label: "Narratives", icon: Waypoints },
  { href: "/news", label: "News → Tokens", icon: Newspaper },
  { href: "/tokens", label: "Token Explorer", icon: Search },
  { href: "/alerts", label: "Alerts", icon: Bell },
] as const

const TOUR = [
  ["New Pairs", "See Ethereum/WETH tokens as they launch."],
  ["LP Burn Watch", "Detect liquidity burns automatically."],
  ["Trends", "Find names and tickers gaining momentum."],
  ["Narratives", "Discover clusters of related token launches."],
  ["News → Tokens", "Connect real-world events to token activity."],
] as const

export function AppShell({ children }: { children: ReactNode }) {
  const pathname = usePathname()
  const { snapshot, mode, lastCheck, block } = useLpMonitor()
  const [open, setOpen] = useState(false)
  const [queryOpen, setQueryOpen] = useState(false)
  const [feed, setFeed] = useState(false)
  const [tour, setTour] = useState(false)
  const [now, setNow] = useState<number | null>(null)
  const [theme, setTheme] = useState<ThemeId>("dark")

  useEffect(() => {
    const saved = localStorage.getItem("weth-theme")
    const next = isThemeId(saved) ? saved : "dark"
    setTheme(next)
    applyTheme(next)
    setFeed(localStorage.getItem("weth-activity-feed") !== "off")
    setTour(localStorage.getItem("weth-onboarded") !== "1")
    setNow(Date.now())
    const timer = window.setInterval(() => setNow(Date.now()), 1000)
    function onKey(event: KeyboardEvent) {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "k") {
        event.preventDefault()
        setQueryOpen(true)
      }
    }
    window.addEventListener("keydown", onKey)
    return () => {
      window.clearInterval(timer)
      window.removeEventListener("keydown", onKey)
    }
  }, [])

  useEffect(() => {
    if (theme !== "system") return
    const media = window.matchMedia("(prefers-color-scheme: dark)")
    const sync = () => applyTheme("system")
    sync()
    media.addEventListener("change", sync)
    return () => media.removeEventListener("change", sync)
  }, [theme])

  useEffect(() => {
    setOpen(false)
  }, [pathname])

  const latestPair = useMemo(() => {
    const rows = snapshot?.rows ?? []
    return rows.reduce<string | null>((best, row) => (!best || row.created_at > best ? row.created_at : best), null)
  }, [snapshot])
  const latestBurn = useMemo(() => {
    if (!snapshot) return null
    return eventsOf(snapshot).reduce<string | null>((best, event) => (!best || event.detectedAt > best ? event.detectedAt : best), null)
  }, [snapshot])

  const statusText = mode === "realtime" ? "Live Ethereum feed" : mode === "paused" ? "LP burn monitor paused" : mode === "error" ? "Feed reconnecting" : "LP burn monitor polling"

  return (
    <div className="flex min-h-full flex-col">
      <header className="sticky top-0 z-30 border-b border-foreground/10 bg-background/90 backdrop-blur">
        <div className="page-wrap flex items-center gap-3 py-3">
          <Link href="/" className="shrink-0 text-sm font-semibold tracking-tight">WETH Live</Link>
          <button type="button" className="rounded-md p-2 text-muted-foreground lg:hidden" aria-label="Open navigation" onClick={() => setOpen((value) => !value)}>
            {open ? <X size={18} /> : <Menu size={18} />}
          </button>
          <nav className={`${open ? "flex" : "hidden"} absolute top-14 right-0 left-0 flex-col gap-1 border-b border-foreground/10 bg-background p-3 lg:static lg:flex lg:flex-1 lg:flex-row lg:gap-1 lg:border-0 lg:bg-transparent lg:p-0`}>
            {LINKS.map((link) => {
              const active = link.href === "/" ? pathname === "/" : pathname === link.href || pathname.startsWith(`${link.href}/`)
              const Icon = link.icon
              return (
                <Link key={link.href} href={link.href} className={`flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-sm ${active ? "bg-primary/15 text-primary" : "text-muted-foreground hover:bg-muted hover:text-foreground"}`}>
                  <Icon size={14} aria-hidden />
                  {link.label}
                  {active ? <span className="sr-only">, current page</span> : null}
                </Link>
              )
            })}
          </nav>
          <ThemeSwitch theme={theme} onChange={(next) => { setTheme(next); applyTheme(next) }} />
          <button type="button" onClick={() => setQueryOpen(true)} className="hidden items-center gap-2 rounded-md bg-card px-3 py-1.5 text-xs text-muted-foreground ring-1 ring-foreground/10 sm:flex">
            <Search size={14} /> Search token, ticker, contract…
            <kbd className="rounded bg-muted px-1.5 py-0.5">Ctrl K</kbd>
          </button>
          <button type="button" className="rounded-md p-2 text-muted-foreground sm:hidden" aria-label="Search" onClick={() => setQueryOpen(true)}><Search size={16} /></button>
        </div>
        <div className="page-wrap flex flex-wrap items-center gap-x-4 gap-y-1 border-t border-foreground/5 py-2 text-xs text-muted-foreground">
          <span className="inline-flex items-center gap-1.5 text-foreground"><span className={`size-1.5 rounded-full ${mode === "error" ? "bg-destructive" : mode === "paused" ? "bg-amber-400" : "bg-emerald-400"} ${mode === "active" || mode === "realtime" ? "live-dot" : ""}`} />{statusText}</span>
          <span>{block ? `Ethereum block ${block.toLocaleString("en-US")}` : "Ethereum block waiting"}</span>
          <span>Latest pair {latestPair && now ? ago(now - Date.parse(latestPair)) : "waiting"}</span>
          <span>Latest LP burn {latestBurn && now ? ago(now - Date.parse(latestBurn)) : "waiting"}</span>
          <span>Dataset {snapshot && now ? ago(now - Date.parse(snapshot.generatedAt)) : "waiting"}</span>
          <span>Last monitor check {lastCheck && now ? ago(now - lastCheck) : "waiting"}</span>
          <button type="button" className="ml-auto text-foreground underline" onClick={() => { const next = !feed; setFeed(next); localStorage.setItem("weth-activity-feed", next ? "on" : "off") }}>{feed ? "Hide activity feed" : "Show activity feed"}</button>
        </div>
      </header>
      <div className="flex min-w-0 flex-1">
        <div className="min-w-0 flex-1">{children}</div>
        {feed ? <Activity snapshotRows={snapshot?.rows ?? []} burns={snapshot ? eventsOf(snapshot).slice(0, 6) : []} /> : null}
      </div>
      {queryOpen ? <CommandSearch onClose={() => setQueryOpen(false)} /> : null}
      {tour ? <Welcome onClose={(forever) => { if (forever) localStorage.setItem("weth-onboarded", "1"); setTour(false) }} /> : null}
      <p className="sr-only">{statusText}</p>
    </div>
  )
}

function ThemeSwitch({ theme, onChange }: { theme: ThemeId; onChange: (theme: ThemeId) => void }) {
  const options = [
    { id: "light" as const, label: "Light", icon: Sun },
    { id: "dark" as const, label: "Dark", icon: Moon },
    { id: "system" as const, label: "System", icon: Monitor },
  ]
  return (
    <div className="ml-auto flex rounded-md bg-card p-0.5 ring-1 ring-foreground/10" role="radiogroup" aria-label="Theme">
      {options.map((option) => {
        const Icon = option.icon
        const selected = theme === option.id
        return (
          <button
            key={option.id}
            type="button"
            role="radio"
            aria-checked={selected}
            aria-label={option.label}
            title={option.label}
            onClick={() => onChange(option.id)}
            className={`rounded px-2 py-1 ${selected ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"}`}
          >
            <Icon size={14} />
          </button>
        )
      })}
    </div>
  )
}

function Activity({ snapshotRows, burns }: { snapshotRows: { name: string; created_at: string; address: string }[]; burns: { detectedAt: string; symbol: string; tokenName: string }[] }) {
  const rows = [...snapshotRows].sort((a, b) => b.created_at.localeCompare(a.created_at)).slice(0, 6)
  return (
    <aside className="sticky top-28 hidden h-[calc(100vh-7rem)] w-72 shrink-0 overflow-auto border-l border-foreground/10 px-4 py-6 xl:block">
      <h2 className="text-xs font-medium tracking-[0.16em] text-muted-foreground uppercase">Live activity</h2>
      <ul className="mt-4 flex flex-col gap-3 text-sm">
        {burns.slice(0, 4).map((event) => (
          <li key={`${event.symbol}${event.detectedAt}`}>
            <p className="text-xs text-muted-foreground">{new Date(event.detectedAt).toLocaleTimeString()}</p>
            <p>LP burned · {event.symbol}</p>
            <p className="text-xs text-muted-foreground">{event.tokenName}</p>
          </li>
        ))}
        {rows.map((row) => (
          <li key={row.address}>
            <p className="text-xs text-muted-foreground">{new Date(row.created_at).toLocaleTimeString()}</p>
            <p>New pair · {row.name}</p>
          </li>
        ))}
        {rows.length === 0 && burns.length === 0 ? <li className="text-muted-foreground">Activity appears after the dataset loads.</li> : null}
      </ul>
    </aside>
  )
}

function CommandSearch({ onClose }: { onClose: () => void }) {
  const { snapshot } = useLpMonitor()
  const router = useRouter()
  const [query, setQuery] = useState("")
  const needle = query.trim().toLowerCase()
  const tokens = (snapshot?.rows ?? []).filter((row) => {
    if (!needle) return false
    const identity = parseIdentity(row)
    return `${identity.symbol} ${identity.tokenName} ${row.address} ${row.tokenAddress} ${row.deployer ?? ""}`.toLowerCase().includes(needle)
  }).slice(0, 8)
  const narratives = CONCEPTS.filter((concept) => needle && `${concept.label} ${concept.aliases.join(" ")}`.toLowerCase().includes(needle)).slice(0, 5)

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center bg-black/60 p-4" onClick={onClose}>
      <div className="mt-16 w-full max-w-xl rounded-xl bg-popover p-3 ring-1 ring-foreground/10" onClick={(event) => event.stopPropagation()} role="dialog" aria-label="Search">
        <input autoFocus value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search token, ticker, contract, narrative…" className="w-full rounded-md bg-muted px-3 py-2 text-sm outline-none" />
        <ul className="mt-2 max-h-80 overflow-auto text-sm">
          {tokens.map((row) => {
            const identity = parseIdentity(row)
            return (
              <li key={row.address}>
                <button type="button" className="flex w-full flex-col rounded-md px-2 py-2 text-left hover:bg-muted" onClick={() => { router.push(`/tokens/${row.tokenAddress}`); onClose() }}>
                  <span>{identity.symbol} · {identity.tokenName}</span>
                  <span className="text-xs text-muted-foreground">{row.tokenAddress}</span>
                </button>
              </li>
            )
          })}
          {narratives.map((concept) => (
            <li key={concept.id}>
              <button type="button" className="w-full rounded-md px-2 py-2 text-left hover:bg-muted" onClick={() => { router.push(`/trends/${concept.id}`); onClose() }}>Narrative · {concept.label}</button>
            </li>
          ))}
          {needle && tokens.length === 0 && narratives.length === 0 ? <li className="px-2 py-3 text-muted-foreground">No token, contract, or narrative matched.</li> : null}
        </ul>
      </div>
    </div>
  )
}

function Welcome({ onClose }: { onClose: (forever: boolean) => void }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
      <div className="w-full max-w-lg rounded-xl bg-popover p-5 ring-1 ring-foreground/10" role="dialog" aria-labelledby="welcome-title">
        <p className="text-xs tracking-[0.16em] text-primary uppercase">Welcome</p>
        <h2 id="welcome-title" className="mt-1 text-2xl font-semibold">WETH Live Pairs</h2>
        <ol className="mt-4 flex flex-col gap-2 text-sm">
          {TOUR.map(([title, body], index) => (
            <li key={title}><span className="text-muted-foreground">{index + 1}. </span><span className="font-medium">{title}</span> — {body}</li>
          ))}
        </ol>
        <div className="mt-5 flex gap-2">
          <button type="button" className="rounded-md bg-primary px-3 py-1.5 text-sm text-primary-foreground" onClick={() => onClose(true)}>Don&apos;t show again</button>
          <button type="button" className="rounded-md bg-muted px-3 py-1.5 text-sm" onClick={() => onClose(false)}>Skip</button>
        </div>
      </div>
    </div>
  )
}
