"use client"

import { ChevronLeft, ChevronRight } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Label } from "@/components/ui/label"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"

type PagerProps = {
  total: number
  page: number
  pageSize: number
  pageSizes: number[]
  onPageChange: (page: number) => void
  onPageSizeChange: (size: number) => void
  idPrefix: string
}

/** Page numbers to show: first, last, and a window around the current page. */
export function pageItems(page: number, pageCount: number): (number | "gap")[] {
  if (pageCount <= 7) return Array.from({ length: pageCount }, (_, index) => index + 1)
  const pages = new Set([1, pageCount, page - 1, page, page + 1])
  if (page <= 3) [2, 3, 4].forEach((value) => pages.add(value))
  if (page >= pageCount - 2) [pageCount - 3, pageCount - 2, pageCount - 1].forEach((value) => pages.add(value))
  const sorted = [...pages].filter((value) => value >= 1 && value <= pageCount).sort((a, b) => a - b)
  const items: (number | "gap")[] = []
  sorted.forEach((value, index) => {
    if (index > 0 && value - sorted[index - 1] > 1) items.push("gap")
    items.push(value)
  })
  return items
}

export function Pager({
  total,
  page,
  pageSize,
  pageSizes,
  onPageChange,
  onPageSizeChange,
  idPrefix,
}: PagerProps) {
  const pageCount = Math.max(1, Math.ceil(total / pageSize))
  const current = Math.min(page, pageCount)
  const first = total === 0 ? 0 : (current - 1) * pageSize + 1
  const last = Math.min(total, current * pageSize)

  return (
    <nav
      aria-label="Pagination"
      className="flex flex-col gap-3 border-t border-border pt-4 lg:flex-row lg:items-center lg:justify-between"
    >
      <p className="text-sm text-muted-foreground" aria-live="polite">
        Showing <span className="font-medium text-foreground">{first}</span> to{" "}
        <span className="font-medium text-foreground">{last}</span> of{" "}
        <span className="font-medium text-foreground">{total}</span>
      </p>

      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:gap-5">
        <div className="flex items-center gap-2">
          <Label htmlFor={`${idPrefix}-size`} className="text-sm text-muted-foreground">
            Per page
          </Label>
          <Select
            value={String(pageSize)}
            onValueChange={(value) => {
              if (value) onPageSizeChange(Number(value))
            }}
          >
            <SelectTrigger id={`${idPrefix}-size`} className="w-20">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {pageSizes.map((size) => (
                <SelectItem key={size} value={String(size)}>
                  {size}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="flex items-center gap-1">
          <Button
            type="button"
            variant="outline"
            size="icon"
            aria-label="Previous page"
            onClick={() => onPageChange(current - 1)}
            disabled={current <= 1}
          >
            <ChevronLeft />
          </Button>
          {pageItems(current, pageCount).map((item, index) =>
            item === "gap" ? (
              <span
                key={`gap-${index}`}
                aria-hidden="true"
                className="flex size-8 items-center justify-center text-muted-foreground"
              >
                ...
              </span>
            ) : (
              <Button
                key={item}
                type="button"
                variant={item === current ? "default" : "ghost"}
                size="icon"
                aria-label={`Page ${item}`}
                aria-current={item === current ? "page" : undefined}
                onClick={() => onPageChange(item)}
              >
                {item}
              </Button>
            ),
          )}
          <Button
            type="button"
            variant="outline"
            size="icon"
            aria-label="Next page"
            onClick={() => onPageChange(current + 1)}
            disabled={current >= pageCount}
          >
            <ChevronRight />
          </Button>
        </div>
      </div>
    </nav>
  )
}
