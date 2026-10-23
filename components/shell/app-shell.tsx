"use client"

import { Component, useCallback, useEffect, useMemo, useState, type ReactNode } from "react"
import Link from "next/link"
import { usePathname, useRouter } from "next/navigation"
import { Activity as ActivityIcon, Bell, CircleHelp, Flame, LayoutDashboard, Maximize2, Menu, Monitor, Moon, Newspaper, Search, Settings, Sun, TrendingUp, Waypoints, X, Zap } from "lucide-react"
import { BackfillLink, HistoryBanner } from "@/components/progress/history-panel"
import { applyTheme, isThemeId, type ThemeId } from "@/lib/theme"
import { ago, eventsOf } from "@/lib/lp/monitor"
import { useLpMonitor, type MonitorMode } from "@/components/lp/monitor-context"
import { parseIdentity } from "@/lib/narrative/text"
import { CONCEPTS } from "@/lib/narrative/lexicon"
import { EthMarketWidget, EthereumGasWidget, notifyMarketBlock } from "@/components/shell/market-widgets"
import { ActivityBoard, SafeBoard } from "@/components/shell/activity-board"
import type { SnapshotFile } from "@/lib/narrative/types"
import { LiveActivity } from "@/components/shell/live-activity"
import { Popover } from "@/components/shell/popover"
import { activityEngine } from "@/lib/activity/client"

function isActivityRoute(path: string | null): boolean {
  return path === "/all" || path === "/all/" || (path?.startsWith("/all/") ?? false)
}

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

/** Shown in the right-hand header cluster on wide screens and in the menu on narrow ones. */
const UTILITY_LINKS = [
  { href: "/system", label: "Diagnostics", icon: ActivityIcon },
  { href: "/help", label: "Help", icon: CircleHelp },
] as const

const TOUR = [
  ["New Pairs", "See Ethereum/WETH tokens as they launch."],
  ["LP Burn Watch", "Detect liquidity burns automatically."],
  ["Trends", "Find names and tickers gaining momentum."],
  ["Narratives", "Discover clusters of related token launches."],
  ["News → Tokens", "Connect real-world events to token activity."],
] as const

class BoardBoundary extends Component<{ snapshot: SnapshotFile | null; mode: MonitorMode; onClose: () => void }, { safe: boolean }> {
  state = { safe: false }
  private retried = false
  private alive = true
  static getDerivedStateFromError(): { safe: boolean } {
    return { safe: true }
  }
  componentDidCatch(error: Error) {
    console.error(error)
    if (this.retried) return
    this.retried = true
    window.setTimeout(() => {
      if (this.alive) this.setState({ safe: false })
    }, 400)
  }
  componentWillUnmount() {
    this.alive = false
  }
  render() {
    if (this.state.safe) return <SafeBoard snapshot={this.props.snapshot} onClose={this.props.onClose} />
    return <ActivityBoard snapshot={this.props.snapshot} mode={this.props.mode} onClose={this.props.onClose} />
  }
}

export function AppShell({ children }: { children: ReactNode }) {
  const pathname = usePathname()
  const router = useRouter()
  const { snapshot, mode, lastCheck, block, alerts, dismiss } = useLpMonitor()
  const [open, setOpen] = useState(false)
  const [queryOpen, setQueryOpen] = useState(false)
  const [feed, setFeed] = useState(() => isActivityRoute(pathname))
  const [expanded, setExpanded] = useState(() => isActivityRoute(pathname))
  const closeBoard = useCallback(() => {
    setExpanded(false)
    if (isActivityRoute(pathname)) router.push("/")
  }, [pathname, router])
  function setFeedOn(next: boolean) {
    setFeed(next)
    if (!next) setExpanded(false)
    localStorage.setItem("weth-activity-feed", next ? "on" : "off")
  }
  const [tour, setTour] = useState(false)
  const [now, setNow] = useState<number | null>(null)
  const [theme, setTheme] = useState<ThemeId>("dark")

  useEffect(() => {
    const saved = localStorage.getItem("weth-theme")
    const next = isThemeId(saved) ? saved : "dark"
    setTheme(next)
    applyTheme(next)
    const activityRoute = isActivityRoute(window.location.pathname)
    setFeed(activityRoute || localStorage.getItem("weth-activity-feed") !== "off")
    if (activityRoute) setExpanded(true)
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
    if (!isActivityRoute(pathname)) return
    setFeed(true)
    setExpanded(true)
  }, [pathname])

  useEffect(() => {
    if (block == null) return
    notifyMarketBlock()
    activityEngine()?.onHead(block)
  }, [block])

  const latestPair = useMemo(() => {
    const rows = snapshot?.rows ?? []
    return rows.reduce<string | null>((best, row) => (!best || row.created_at > best ? row.created_at : best), null)
  }, [snapshot])
  const latestBurn = useMemo(() => {
    if (!snapshot) return null
    return eventsOf(snapshot).reduce<string | null>((best, event) => {
      const at = event.burnAt || event.detectedAt
      return !best || at > best ? at : best
    }, null)
  }, [snapshot])

  const statusText = mode === "realtime" ? "Live Ethereum feed" : mode === "paused" ? "LP burn monitor paused" : mode === "error" ? "Feed reconnecting" : "LP burn monitor polling"

  return (
    <div className="flex min-h-full flex-col">
      <header className="sticky top-0 z-30 border-b border-foreground/10 bg-background/90 backdrop-blur">
        <div className="page-wrap flex h-14 items-center gap-1.5 sm:gap-2 xl:gap-3">
          <Link href="/" className="shrink-0 text-sm font-semibold tracking-tight whitespace-nowrap">WETH Live</Link>
          <nav aria-label="Main" className={`${open ? "flex" : "hidden"} absolute top-14 right-0 left-0 max-h-[calc(100vh-3.5rem)] flex-col gap-1 overflow-y-auto border-b border-foreground/10 bg-background p-3 xl:static xl:flex xl:min-w-0 xl:flex-1 xl:flex-row xl:gap-0.5 xl:overflow-visible xl:border-0 xl:bg-transparent xl:p-0`}>
            {LINKS.map((link) => {
              const active = link.href === "/" ? pathname === "/" : pathname === link.href || pathname.startsWith(`${link.href}/`)
              const Icon = link.icon
              return (
                <Link key={link.href} href={link.href} className={`flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-sm whitespace-nowrap xl:px-1.5 xl:text-[13px] min-[1440px]:px-2 ${active ? "bg-primary/15 text-primary" : "text-muted-foreground hover:bg-muted hover:text-foreground"}`}>
                  <Icon size={14} aria-hidden className="xl:hidden min-[1440px]:inline" />
                  {link.label}
                  {active ? <span className="sr-only">, current page</span> : null}
                </Link>
              )
            })}
            <div className="mt-2 flex flex-col gap-1 border-t border-foreground/10 pt-2 sm:hidden">
              {UTILITY_LINKS.map((link) => {
                const Icon = link.icon
                return (
                  <Link key={link.href} href={link.href} className="flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-sm text-muted-foreground hover:bg-muted hover:text-foreground">
                    <Icon size={14} aria-hidden />
                    {link.label}
                  </Link>
                )
              })}
              <div className="flex items-center justify-between px-2.5 py-1.5 text-sm text-muted-foreground">
                Theme
                <ThemeSwitch theme={theme} onChange={(next) => { setTheme(next); applyTheme(next) }} />
              </div>
            </div>
          </nav>
          <div className="ml-auto flex shrink-0 items-center gap-1.5 sm:gap-2">
            <button type="button" onClick={() => setQueryOpen(true)} aria-label="Search token, ticker, or contract (Ctrl K)" className="flex h-8 items-center gap-2 rounded-md px-2 text-xs text-muted-foreground hover:text-foreground min-[1900px]:bg-card min-[1900px]:px-3 min-[1900px]:ring-1 min-[1900px]:ring-foreground/10">
              <Search size={15} aria-hidden />
              <span className="hidden min-[1900px]:inline">Search token, ticker, contract…</span>
              <kbd className="hidden rounded bg-muted px-1.5 py-0.5 min-[1900px]:inline">Ctrl K</kbd>
            </button>
            <EthMarketWidget />
            <EthereumGasWidget />
            <Link href="/system" aria-label="Diagnostics" title="Diagnostics" className={`hidden h-8 items-center rounded-md px-2 sm:flex ${pathname.startsWith("/system") ? "bg-primary/15 text-primary" : "text-muted-foreground hover:bg-muted hover:text-foreground"}`}>
              <ActivityIcon size={15} aria-hidden />
            </Link>
            <div className="hidden sm:block">
              <Popover label="Settings" className="flex h-8 items-center px-2 text-muted-foreground hover:bg-muted hover:text-foreground" trigger={<Settings size={15} aria-hidden />} panelClassName="w-60">
                <p className="text-xs font-medium tracking-[0.16em] text-muted-foreground uppercase">Settings</p>
                <div className="mt-3 flex items-center justify-between">
                  <span>Theme</span>
                  <ThemeSwitch theme={theme} onChange={(next) => { setTheme(next); applyTheme(next) }} />
                </div>
                <button type="button" className="mt-3 flex w-full items-center justify-between" onClick={() => setFeedOn(!feed)}>
                  <span>Live activity panel</span>
                  <span className="text-muted-foreground">{feed ? "On" : "Off"}</span>
                </button>
                <Link href="/help" className="mt-3 flex items-center gap-1.5 text-primary hover:underline"><CircleHelp size={14} aria-hidden /> Help and data sources</Link>
              </Popover>
            </div>
            <button type="button" className="rounded-md p-2 text-muted-foreground xl:hidden" aria-label={open ? "Close navigation" : "Open navigation"} aria-expanded={open} onClick={() => setOpen((value) => !value)}>
              {open ? <X size={18} /> : <Menu size={18} />}
            </button>
          </div>
        </div>
        <div className="page-wrap flex flex-wrap items-center gap-x-4 gap-y-1 border-t border-foreground/5 py-2 text-xs text-muted-foreground">
          <span className="inline-flex items-center gap-1.5 text-foreground"><span className={`size-1.5 rounded-full ${mode === "error" ? "bg-destructive" : mode === "paused" ? "bg-amber-400" : "bg-emerald-400"} ${mode === "active" || mode === "realtime" ? "live-dot" : ""}`} />{statusText}</span>
          <span>{block ? `Ethereum block ${block.toLocaleString("en-US")}` : "Ethereum block waiting"}</span>
          <span>Latest pair {latestPair && now ? ago(now - Date.parse(latestPair)) : "waiting"}</span>
          <span>Latest LP burn {latestBurn && now ? ago(now - Date.parse(latestBurn)) : "waiting"}</span>
          <span>Chain monitor {snapshot?.chain?.lastSuccessAt && now ? ago(now - Date.parse(snapshot.chain.lastSuccessAt)) : "waiting"}</span>
          <span>LP burn store {snapshot?.lpScan?.scannedAt && now ? ago(now - Date.parse(snapshot.lpScan.scannedAt)) : "waiting"}</span>
          <span>Trend data {snapshot && now ? ago(now - Date.parse(snapshot.generatedAt)) : "waiting"}</span>
          <span>Last monitor check {lastCheck && now ? ago(now - lastCheck) : "waiting"}</span>
          <BackfillLink backfill={snapshot?.backfill} />
          <span className="ml-auto inline-flex items-center gap-3">
            {feed && !expanded ? (
              <button type="button" className="inline-flex items-center gap-1 text-foreground underline xl:hidden" onClick={() => setExpanded(true)}>
                <Maximize2 size={12} aria-hidden /> Full screen
              </button>
            ) : null}
            <button type="button" className="text-foreground underline" onClick={() => setFeedOn(!feed)}>{feed ? "Hide activity feed" : "Show activity feed"}</button>
          </span>
        </div>
      </header>
      <HistoryBanner backfill={snapshot?.backfill} />
      <div className="flex min-w-0 flex-1">
        <div className="min-w-0 flex-1">{children}</div>
        {feed ? <LiveActivity snapshot={snapshot} mode={mode} expanded={expanded} onExpanded={setExpanded} /> : null}
      </div>
      {feed && expanded ? (
        <BoardBoundary snapshot={snapshot} mode={mode} onClose={closeBoard} />
      ) : null}
      {queryOpen ? <CommandSearch onClose={() => setQueryOpen(false)} /> : null}
      {tour ? <Welcome onClose={(forever) => { if (forever) localStorage.setItem("weth-onboarded", "1"); setTour(false) }} /> : null}
      <div className="pointer-events-none fixed right-4 bottom-4 z-40 flex w-[min(100%-2rem,22rem)] flex-col gap-2">
        {alerts.map((event) => (
          <article key={event.id} className="pointer-events-auto rounded-xl bg-card p-3 text-sm shadow-lg ring-1 ring-primary/40">
            <div className="flex items-start justify-between gap-3">
              <p className="font-medium">🔥 NEW LP BURN</p>
              <button type="button" className="text-xs text-muted-foreground" onClick={() => dismiss(event.id)}>Dismiss</button>
            </div>
            <p className="mt-1">{event.tokenName} / WETH</p>
            <p className="text-muted-foreground">{event.percentKnown === false ? "LP burn % N/A" : `${event.lpBurntPercent}% LP burned`}</p>
            <Link href={`/tokens/${event.tokenAddress}`} className="mt-2 inline-block text-primary">View</Link>
          </article>
        ))}
      </div>
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
    <div className="flex rounded-md bg-card p-0.5 ring-1 ring-foreground/10" role="radiogroup" aria-label="Theme">
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
