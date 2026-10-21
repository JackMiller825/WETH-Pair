"use client"

import { useEffect, useId, useRef, useState, type ReactNode } from "react"

/** Click-to-open panel. Escape or a click outside closes it and returns focus to the trigger. */
export function Popover({
  label,
  trigger,
  children,
  className = "",
  panelClassName = "",
}: {
  label: string
  trigger: ReactNode
  children: ReactNode | ((close: () => void) => ReactNode)
  className?: string
  panelClassName?: string
}) {
  const [open, setOpen] = useState(false)
  const id = useId()
  const root = useRef<HTMLDivElement>(null)
  const button = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    if (!open) return
    function onDown(event: PointerEvent) {
      if (root.current && !root.current.contains(event.target as Node)) setOpen(false)
    }
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setOpen(false)
        button.current?.focus()
      }
    }
    document.addEventListener("pointerdown", onDown)
    document.addEventListener("keydown", onKey)
    return () => {
      document.removeEventListener("pointerdown", onDown)
      document.removeEventListener("keydown", onKey)
    }
  }, [open])

  const close = () => setOpen(false)
  return (
    <div ref={root} className="relative">
      <button
        ref={button}
        type="button"
        aria-label={label}
        aria-expanded={open}
        aria-controls={id}
        aria-haspopup="dialog"
        onClick={() => setOpen((value) => !value)}
        className={`rounded-md outline-none focus-visible:ring-2 focus-visible:ring-primary ${className}`}
      >
        {trigger}
      </button>
      {open ? (
        <div id={id} role="dialog" aria-label={label} className={`absolute top-full right-0 z-50 mt-2 rounded-xl bg-popover p-4 text-sm text-popover-foreground shadow-xl ring-1 ring-foreground/15 ${panelClassName}`}>
          {typeof children === "function" ? children(close) : children}
        </div>
      ) : null}
    </div>
  )
}
