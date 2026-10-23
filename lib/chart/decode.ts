function word(data: string, index: number): bigint {
  const hex = data.startsWith("0x") ? data.slice(2) : data
  const chunk = hex.slice(index * 64, index * 64 + 64)
  if (chunk.length !== 64 || !/^[0-9a-fA-F]+$/.test(chunk)) throw new Error("ABI word is malformed")
  return BigInt(`0x${chunk}`)
}

/** Integer token units. Decimals are never assumed to be 18. */
export function rawToUnits(raw: bigint, decimals: number): number {
  if (!Number.isInteger(decimals) || decimals < 0 || decimals > 36) return Number.NaN
  const scale = BigInt(10) ** BigInt(decimals)
  const whole = raw / scale
  const fraction = raw % scale
  return Number(whole) + Number(fraction) / Number(scale)
}

export type DecodedSwap = {
  side: "buy" | "sell"
  weth: number
  token: number
  /** WETH paid or received per token on this swap. */
  priceWeth: number
}

/**
 * Uniswap V2 Swap data is amount0In, amount1In, amount0Out, amount1Out.
 * A buy sends WETH in and tokens out. WETH may be token0 or token1.
 * Mint, burn, sync, and transfer logs are not swaps and return null.
 */
export function decodeV2Swap(data: string, wethIsToken0: boolean, tokenDecimals: number): DecodedSwap | null {
  let amount0In: bigint
  let amount1In: bigint
  let amount0Out: bigint
  let amount1Out: bigint
  try {
    amount0In = word(data, 0)
    amount1In = word(data, 1)
    amount0Out = word(data, 2)
    amount1Out = word(data, 3)
  } catch {
    return null
  }
  const wethIn = wethIsToken0 ? amount0In : amount1In
  const wethOut = wethIsToken0 ? amount0Out : amount1Out
  const tokenIn = wethIsToken0 ? amount1In : amount0In
  const tokenOut = wethIsToken0 ? amount1Out : amount0Out
  const zero = BigInt(0)
  if (wethIn > zero && tokenOut > zero && wethIn >= wethOut) {
    const weth = rawToUnits(wethIn, 18)
    const token = rawToUnits(tokenOut, tokenDecimals)
    if (!(weth > 0) || !(token > 0)) return null
    return { side: "buy", weth, token, priceWeth: weth / token }
  }
  if (wethOut > zero && tokenIn > zero && wethOut >= wethIn) {
    const weth = rawToUnits(wethOut, 18)
    const token = rawToUnits(tokenIn, tokenDecimals)
    if (!(weth > 0) || !(token > 0)) return null
    return { side: "sell", weth, token, priceWeth: weth / token }
  }
  return null
}

/** Last 20 bytes of an indexed address topic. A short or empty topic is not an address. */
export function topicAddress(topic: string | undefined): string | null {
  if (!topic) return null
  const hex = topic.toLowerCase().replace(/^0x/, "")
  if (hex.length < 40) return null
  const address = `0x${hex.slice(-40)}`
  return /^0x[0-9a-f]{40}$/.test(address) && !/^0x0{40}$/.test(address) ? address : null
}
