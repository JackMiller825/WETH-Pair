"use client"

import { Suspense } from "react"
import { ChartScreen } from "@/components/chart/screen"

export default function ChartPage() {
  return (
    <Suspense fallback={<main className="page-wrap py-6 text-sm text-muted-foreground">Loading chart intelligence.</main>}>
      <ChartScreen />
    </Suspense>
  )
}
