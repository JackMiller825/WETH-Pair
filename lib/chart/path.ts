/** Opens Chart Intelligence for one pair. Static Pages keeps the pair in the query string. */
export function chartPath(pair: string): string {
  return `/chart/?pair=${encodeURIComponent(pair.toLowerCase())}`
}
