import { execFile } from "node:child_process"
import { promisify } from "node:util"
import { fetchGasTracker } from "../lib/market/gas-tracker"
import { GAS_TRACKER_GIST_ID } from "./gas-live"

const execFileAsync = promisify(execFile)

async function githubToken(): Promise<string> {
  const gh = process.env.GH_BIN || "gh"
  const { stdout } = await execFileAsync(gh, ["auth", "token"], { timeout: 20_000 })
  return String(stdout).trim()
}

/** Read Etherscan's live tables and store them where the publish job can read them. */
async function main() {
  const board = await fetchGasTracker()
  const token = await githubToken()
  const response = await fetch(`https://api.github.com/gists/${GAS_TRACKER_GIST_ID}`, {
    method: "PATCH",
    headers: {
      accept: "application/vnd.github+json",
      authorization: `Bearer ${token}`,
      "content-type": "application/json",
      "user-agent": "weth-live-pairs",
      "x-github-api-version": "2022-11-28",
    },
    body: JSON.stringify({ files: { "gas-tracker.json": { content: JSON.stringify(board) } } }),
    signal: AbortSignal.timeout(30_000),
  })
  if (!response.ok) {
    const detail = (await response.text()).replace(/\s+/g, " ").slice(0, 180)
    throw new Error(`Gist update HTTP ${response.status} ${detail}`)
  }
  console.log(`[GAS] Gist block ${board.block ?? "?"} · ${board.guzzlers.length} guzzlers · ${board.spenders.length} spenders`)
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error)
  process.exit(1)
})
