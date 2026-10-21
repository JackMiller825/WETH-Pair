import { execFile } from "node:child_process"
import { access, chmod, mkdir, readFile, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import { promisify } from "node:util"
import { GAS_TRACKER_PAGE, gasTrackerForm, gasTrackerTableUrl, parseGasTracker, rowsFromTrackerPayload, type GasTrackerFile, type GasTrackerRow } from "../lib/market/gas-tracker"

const execFileAsync = promisify(execFile)
const VERSION = "v2.3.0"
const ARCHIVE = {
  win32: "curl-impersonate-v2.3.0.x86_64-win32.tar.gz",
  linux: "curl-impersonate-v2.3.0.x86_64-linux-gnu.tar.gz",
  darwin: "curl-impersonate-v2.3.0.x86_64-macos.tar.gz",
} as const

let binaryPromise: Promise<string> | null = null

async function browserCurl(): Promise<string> {
  binaryPromise ??= installBrowserCurl()
  return binaryPromise
}

/** Chrome-fingerprint curl. Etherscan rejects the publish job's normal client. */
async function installBrowserCurl(): Promise<string> {
  const dir = path.join(tmpdir(), "curl-impersonate-2.3.0")
  const exe = path.join(dir, process.platform === "win32" ? "curl-impersonate.exe" : "curl-impersonate")
  try {
    await access(exe)
    return exe
  } catch {
    // Download once per machine.
  }
  const asset = ARCHIVE[process.platform as keyof typeof ARCHIVE]
  if (!asset) throw new Error(`No browser curl build for ${process.platform}`)
  await mkdir(dir, { recursive: true })
  const archive = path.join(dir, asset)
  const response = await fetch(`https://github.com/lexiforest/curl-impersonate/releases/download/${VERSION}/${asset}`, { signal: AbortSignal.timeout(60_000) })
  if (!response.ok) throw new Error(`Browser curl download HTTP ${response.status}`)
  await writeFile(archive, Buffer.from(await response.arrayBuffer()))
  await execFileAsync("tar", ["-xzf", archive, "-C", dir], { timeout: 30_000 })
  if (process.platform !== "win32") await chmod(exe, 0o755)
  await access(exe)
  return exe
}

async function browserRequest(url: string, body: string | null, output: string): Promise<string> {
  const exe = await browserCurl()
  const args = [
    "--compressed",
    "--impersonate",
    "chrome152",
    "-sS",
    "-L",
    "--max-time",
    "25",
    "-H",
    "Accept: application/json, text/javascript, */*; q=0.01",
    "-H",
    "Referer: https://etherscan.io/gastracker",
    "-H",
    "X-Requested-With: XMLHttpRequest",
    "-o",
    output,
    "-w",
    "%{http_code}",
  ]
  if (body != null) args.push("-X", "POST", "-H", "Content-Type: application/x-www-form-urlencoded; charset=UTF-8", "--data", body)
  args.push(url)
  const { stdout } = await execFileAsync(exe, args, {
    timeout: 30_000,
    maxBuffer: 1024,
    env: { ...process.env, LD_LIBRARY_PATH: path.dirname(exe) },
  })
  const status = Number(String(stdout).trim())
  const text = await readFile(output, "utf8")
  if (status !== 200) throw new Error(`HTTP ${status} ${text.replace(/\s+/g, " ").slice(0, 160)}`)
  return text
}

function rowsFrom(text: string, kind: string): GasTrackerRow[] {
  let payload: unknown
  try {
    payload = JSON.parse(text)
  } catch {
    throw new Error(`${kind} was not the gas tracker table. ${text.replace(/\s+/g, " ").slice(0, 160)}`)
  }
  const rows = rowsFromTrackerPayload(payload)
  if (rows.length < 10) throw new Error(`The ${kind} table was incomplete (${rows.length})`)
  return rows
}

/** Read both gas tracker tables with a Chrome-like client. */
export async function fetchGasTrackerBrowser(now = Date.now()): Promise<GasTrackerFile> {
  const dir = path.join(tmpdir(), "curl-impersonate-2.3.0")
  await mkdir(dir, { recursive: true })
  const form = gasTrackerForm()
  const [guzzlerText, spenderText, pageText] = await Promise.all([
    browserRequest(gasTrackerTableUrl("gasguzzler"), form, path.join(dir, "guzzlers.json")),
    browserRequest(gasTrackerTableUrl("gasspender"), form, path.join(dir, "spenders.json")),
    browserRequest(GAS_TRACKER_PAGE, null, path.join(dir, "page.html")).catch(() => ""),
  ])
  return {
    fetchedAt: new Date(now).toISOString(),
    block: pageText ? parseGasTracker(pageText).block : null,
    guzzlers: rowsFrom(guzzlerText, "gasguzzler"),
    spenders: rowsFrom(spenderText, "gasspender"),
  }
}
