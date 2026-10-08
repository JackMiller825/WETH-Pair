import type { ChainFacts } from "@/lib/analysis/report"

const RPCS = ["https://eth.drpc.org", "https://rpc.mevblocker.io"]

async function rpc(method: string, params: unknown[]): Promise<unknown> {
  let last = "RPC failed"
  for (const url of RPCS) {
    try {
      const response = await fetch(url, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
        signal: AbortSignal.timeout(12_000),
      })
      if (!response.ok) throw new Error(`HTTP ${response.status}`)
      const payload = (await response.json()) as { result?: unknown; error?: { message?: string } }
      if (payload.error) throw new Error(payload.error.message || "RPC error")
      return payload.result
    } catch (error) {
      last = error instanceof Error ? error.message : "RPC error"
    }
  }
  throw new Error(last)
}

function hexNumber(value: unknown): number | null {
  if (typeof value !== "string" || !value.startsWith("0x")) return null
  const parsed = Number.parseInt(value, 16)
  return Number.isFinite(parsed) ? parsed : null
}

export async function readChainFacts(address: string): Promise<ChainFacts> {
  const code = (await rpc("eth_getCode", [address, "latest"])) as string
  const bytecodeBytes = typeof code === "string" && code.startsWith("0x") ? Math.max(0, (code.length - 2) / 2) : null
  const decimals = hexNumber(await rpc("eth_call", [{ to: address, data: "0x313ce567" }, "latest"]).catch(() => null))
  const supplyHex = (await rpc("eth_call", [{ to: address, data: "0x18160ddd" }, "latest"]).catch(() => null)) as string | null
  const ownerHex = (await rpc("eth_call", [{ to: address, data: "0x8da5cb5b" }, "latest"]).catch(() => null)) as string | null
  const owner = typeof ownerHex === "string" && ownerHex.length >= 42 ? `0x${ownerHex.slice(-40)}` : null
  return {
    bytecodeBytes,
    decimals,
    totalSupply: typeof supplyHex === "string" && supplyHex !== "0x" ? supplyHex : null,
    owner: owner && !/^0x0{40}$/.test(owner) ? owner : owner,
  }
}
