/** Tooltip and Help text. The header, Live Activity, and the Help page all read from here. */
export const DEFINITIONS = {
  change1h: "ETH price change over the previous hour.",
  change24h: "ETH price change over the previous 24 hours.",
  change7d: "ETH price change over the previous seven days.",
  standard: "Lower-cost fee estimate intended for normal inclusion.",
  fast: "Higher-priority estimate intended for faster inclusion.",
  rapid: "Highest-priority estimate shown by this application.",
  baseFee: "Protocol base fee for the next block. Every transaction pays it.",
  priorityFee: "Tip to the block builder on top of the base fee.",
  pooledWeth: "Current WETH reserve held by this trading pair.",
  totalTx: "Total tracked swap transactions for this trading pair.",
  holders: "Latest available number of addresses currently holding the token.",
} as const

export const SOURCE_LABEL: Record<string, string> = {
  chain: "Ethereum (on-chain)",
  dextools: "DEXTools, published snapshot",
  blockscout: "Blockscout",
  ethplorer: "Ethplorer",
}
