"use client"

import { useEffect, useRef, useState } from "react"
import { Check, Copy } from "lucide-react"
import { shortAddress } from "@/lib/format"

async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text)
    return true
  } catch {
    const area = document.createElement("textarea")
    area.value = text
    area.style.position = "fixed"
    area.style.opacity = "0"
    document.body.appendChild(area)
    area.select()
    const copied = document.execCommand("copy")
    area.remove()
    return copied
  }
}

export function AddressCell({ address, label }: { address: string; label: string }) {
  const [copied, setCopied] = useState(false)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    return () => {
      if (timer.current) clearTimeout(timer.current)
    }
  }, [])

  if (!address) return <span className="text-muted-foreground">-</span>

  async function handleCopy() {
    if (!(await copyText(address))) return
    setCopied(true)
    if (timer.current) clearTimeout(timer.current)
    timer.current = setTimeout(() => setCopied(false), 1500)
  }

  return (
    <span className="inline-flex items-center gap-1.5">
      <span className="font-mono text-xs" title={address}>
        {shortAddress(address)}
      </span>
      <button
        type="button"
        onClick={handleCopy}
        aria-label={copied ? `${label} copied` : `Copy ${label}`}
        title={copied ? "Copied" : `Copy ${label}`}
        className="rounded p-1 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
      >
        {copied ? <Check className="size-3.5 text-emerald-300" /> : <Copy className="size-3.5" />}
      </button>
    </span>
  )
}
