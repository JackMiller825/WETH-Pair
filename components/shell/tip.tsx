"use client"

import { useId, type ReactNode } from "react"

/** A label whose definition shows on hover or keyboard focus and is read by screen readers. */
export function Tip({ label, text, className = "", align = "left" }: { label: ReactNode; text: string; className?: string; align?: "left" | "right" | "center" }) {
  const id = useId()
  const position = align === "right" ? "right-0" : align === "center" ? "left-1/2 -translate-x-1/2" : "left-0"
  return (
    <span className={`group relative inline-flex cursor-help items-center gap-0.5 outline-none ${className}`} tabIndex={0} aria-describedby={id}>
      {label}
      <span aria-hidden className="text-[9px] leading-none opacity-60">ⓘ</span>
      <span id={id} role="tooltip" className={`pointer-events-none absolute top-full z-50 mt-1 hidden w-52 rounded-md bg-popover p-2 text-left text-xs font-normal tracking-normal text-popover-foreground normal-case shadow-lg ring-1 ring-foreground/15 group-hover:block group-focus:block ${position}`}>
        {text}
      </span>
    </span>
  )
}
