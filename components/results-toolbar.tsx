"use client"

import { ArrowDown, ArrowUp, Search, X } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import {
  ALL_EXCHANGES,
  SORT_OPTIONS,
  isFiltered,
  type Filters,
  type SortKey,
  type SortState,
} from "@/lib/view"

type ToolbarProps = {
  filters: Filters
  sort: SortState
  exchanges: { name: string; count: number }[]
  onFiltersChange: (filters: Filters) => void
  onSortChange: (sort: SortState) => void
}

export function ResultsToolbar({ filters, sort, exchanges, onFiltersChange, onSortChange }: ToolbarProps) {
  const active = isFiltered(filters)
  const descending = sort.direction === "desc"

  return (
    <div className="flex flex-col gap-3 lg:flex-row lg:items-end">
      <div className="flex min-w-0 flex-1 flex-col gap-2">
        <Label htmlFor="filter-name">Name</Label>
        <div className="relative">
          <Search className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            id="filter-name"
            type="search"
            value={filters.name}
            onChange={(event) => onFiltersChange({ ...filters, name: event.target.value })}
            placeholder="Filter by name"
            autoComplete="off"
            className="pl-8"
          />
        </div>
      </div>

      <div className="flex flex-col gap-2 lg:w-60">
        <Label htmlFor="filter-exchange">Exchange</Label>
        <Select
          value={filters.exchange}
          onValueChange={(value) => {
            if (value) onFiltersChange({ ...filters, exchange: value })
          }}
        >
          <SelectTrigger id="filter-exchange" className="w-full">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL_EXCHANGES}>All exchanges</SelectItem>
            {exchanges.map((exchange) => (
              <SelectItem key={exchange.name} value={exchange.name}>
                {exchange.name} ({exchange.count})
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="flex flex-col gap-2 lg:w-60">
        <Label htmlFor="sort-key">Sort by</Label>
        <div className="flex gap-2">
          <Select
            value={sort.key}
            onValueChange={(value) => {
              if (value) onSortChange({ ...sort, key: value as SortKey })
            }}
          >
            <SelectTrigger id="sort-key" className="w-full min-w-0 flex-1">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {SORT_OPTIONS.map((option) => (
                <SelectItem key={option.key} value={option.key}>
                  {option.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button
            type="button"
            variant="outline"
            size="icon"
            aria-label={descending ? "Sorted high to low. Switch to low to high." : "Sorted low to high. Switch to high to low."}
            title={descending ? "High to low" : "Low to high"}
            onClick={() => onSortChange({ ...sort, direction: descending ? "asc" : "desc" })}
          >
            {descending ? <ArrowDown /> : <ArrowUp />}
          </Button>
        </div>
      </div>

      {active ? (
        <Button
          type="button"
          variant="ghost"
          onClick={() => onFiltersChange({ name: "", exchange: ALL_EXCHANGES })}
        >
          <X />
          Clear filters
        </Button>
      ) : null}
    </div>
  )
}
