"use client"

import { useEffect, useId, useRef, useState, type ReactNode } from "react"
import { createPortal } from "react-dom"
import { placeFloatingPanel, type PanelBox } from "@/lib/ui/place-panel"

/** Click-to-open panel. Escape or a click outside closes it and returns focus to the trigger. */
export function Popover({
  label,
  trigger,
  children,
  className = "",
  panelClassName = "",
  floating = false,
  floatingWidth = 320,
}: {
  label: string
  trigger: ReactNode
  children: ReactNode | ((close: () => void) => ReactNode)
  className?: string
  panelClassName?: string
  /** Draw the panel on the document, so a scrolling column cannot clip it. */
  floating?: boolean
  floatingWidth?: number
}) {
  const [open, setOpen] = useState(false)
  const [box, setBox] = useState<PanelBox | null>(null)
  const id = useId()
  const root = useRef<HTMLDivElement>(null)
  const button = useRef<HTMLButtonElement>(null)
  const panel = useRef<HTMLDivElement>(null)

  function place() {
    if (!button.current) return
    const rect = button.current.getBoundingClientRect()
    setBox(placeFloatingPanel(rect, { width: window.innerWidth, height: window.innerHeight }, floatingWidth))
  }

  useEffect(() => {
    if (!open) return
    function onDown(event: PointerEvent) {
      const target = event.target as Node
      if (root.current?.contains(target) || panel.current?.contains(target)) return
      setOpen(false)
    }
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setOpen(false)
        button.current?.focus()
      }
    }
    function onMove() {
      if (!button.current) return
      const rect = button.current.getBoundingClientRect()
      if (rect.bottom < 0 || rect.top > window.innerHeight) {
        setOpen(false)
        return
      }
      setBox(placeFloatingPanel(rect, { width: window.innerWidth, height: window.innerHeight }, floatingWidth))
    }
    document.addEventListener("pointerdown", onDown)
    document.addEventListener("keydown", onKey)
    if (floating) {
      window.addEventListener("resize", onMove)
      window.addEventListener("scroll", onMove, true)
    }
    return () => {
      document.removeEventListener("pointerdown", onDown)
      document.removeEventListener("keydown", onKey)
      window.removeEventListener("resize", onMove)
      window.removeEventListener("scroll", onMove, true)
    }
  }, [open, floating, floatingWidth])

  const close = () => setOpen(false)
  const body = typeof children === "function" ? children(close) : children
  const floatingPanel = open && floating && box && typeof document !== "undefined"
    ? createPortal(
        <div
          ref={panel}
          id={id}
          role="dialog"
          aria-label={label}
          style={{ top: box.top, left: box.left, width: box.width, maxHeight: box.maxHeight, transform: box.above ? "translateY(-100%)" : undefined }}
          className={`fixed z-[35] overflow-y-auto rounded-xl bg-popover p-3 text-sm text-popover-foreground shadow-xl ring-1 ring-foreground/15 ${panelClassName}`}
        >
          {body}
        </div>,
        document.body,
      )
    : null
  return (
    <div ref={root} className="relative">
      <button
        ref={button}
        type="button"
        aria-label={label}
        aria-expanded={open}
        aria-controls={id}
        aria-haspopup="dialog"
        onClick={() => {
          if (floating) place()
          setOpen((value) => !value)
        }}
        className={`rounded-md outline-none focus-visible:ring-2 focus-visible:ring-primary ${className}`}
      >
        {trigger}
      </button>
      {floating ? floatingPanel : open ? (
        <div ref={panel} id={id} role="dialog" aria-label={label} className={`absolute top-full right-0 z-50 mt-2 rounded-xl bg-popover p-4 text-sm text-popover-foreground shadow-xl ring-1 ring-foreground/15 ${panelClassName}`}>
          {body}
        </div>
      ) : null}
    </div>
  )
}
