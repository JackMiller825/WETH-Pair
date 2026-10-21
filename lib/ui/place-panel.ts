export type PanelBox = {
  top: number
  left: number
  width: number
  maxHeight: number
  above: boolean
}

/** Place a fixed panel against a trigger so it stays inside the viewport. */
export function placeFloatingPanel(
  rect: { top: number; right: number; bottom: number },
  viewport: { width: number; height: number },
  width: number,
  margin = 8,
): PanelBox {
  const panelWidth = Math.min(width, Math.max(160, viewport.width - margin * 2))
  const left = Math.min(Math.max(margin, rect.right - panelWidth), Math.max(margin, viewport.width - panelWidth - margin))
  const below = viewport.height - rect.bottom - margin
  const above = rect.top - margin
  const upward = below < 220 && above > below
  return {
    top: upward ? rect.top - margin : rect.bottom + margin,
    left,
    width: panelWidth,
    maxHeight: Math.max(120, (upward ? above : below) - margin),
    above: upward,
  }
}
