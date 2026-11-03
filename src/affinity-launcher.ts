import { execFile } from "node:child_process"
import { setTimeout as sleep } from "node:timers/promises"
import { AffinityUnavailableError, type AffinityGateway, type AffinityStatus } from "./affinity-client.ts"
import { readPositiveInteger } from "./env.ts"

export interface AffinityLauncher {
  launch(): Promise<void>
}

export interface OpenOptions {
  timeoutMs: number
  pollMs: number
}

export function createLauncher(env: NodeJS.ProcessEnv = process.env, platform = process.platform): AffinityLauncher {
  const bundleId = env.AFFINITY_BUNDLE_ID ?? "com.canva.affinity"

  return {
    launch() {
      if (platform !== "darwin") {
        return Promise.reject(new Error(`Launching Affinity is only supported on macOS (platform: ${platform})`))
      }

      return new Promise((resolve, reject) => {
        execFile("open", ["-g", "-b", bundleId], (error) => {
          if (error) reject(new Error(`open -b ${bundleId} failed: ${error.message}`))
          else resolve()
        })
      })
    },
  }
}

export function readOpenOptions(env: NodeJS.ProcessEnv = process.env): OpenOptions {
  return { timeoutMs: readPositiveInteger(env, "AFFINITY_LAUNCH_TIMEOUT_MS", 120_000), pollMs: 1_000 }
}

export type OpenResult = Extract<AffinityStatus, { state: "connected" | "disconnected" }>

export async function openAffinity(
  gateway: AffinityGateway,
  launcher: AffinityLauncher,
  options: OpenOptions,
): Promise<OpenResult> {
  const url = gateway.status().url
  const connected: OpenResult = { state: "connected", url }

  if (gateway.status().state === "connected") return connected

  // Affinity may already be running with a dropped session; reconnect before launching anything.
  if (await tryConnect(gateway) === undefined) return connected

  await launcher.launch()

  const deadline = Date.now() + options.timeoutMs
  let lastFailure = "connector did not respond before the launch timeout"

  while (Date.now() < deadline) {
    const failure = await tryConnect(gateway)
    if (failure === undefined) return connected

    lastFailure = failure
    await sleep(Math.min(options.pollMs, Math.max(0, deadline - Date.now())))
  }

  return { state: "disconnected", url, reason: lastFailure }
}

/** Every upstream call opens Affinity first and retries once if the session turns out to be stale. */
export function withAutoOpen(
  gateway: AffinityGateway,
  launcher: AffinityLauncher,
  options: OpenOptions,
): AffinityGateway {
  const ensureOpen = async () => {
    const status = await openAffinity(gateway, launcher, options)

    if (status.state !== "connected") {
      throw new AffinityUnavailableError(status.url, new Error(status.reason))
    }
  }

  return {
    status: () => gateway.status(),
    connect: () => gateway.connect(),
    close: () => gateway.close(),
    async callTool(name, args) {
      await ensureOpen()

      try {
        return await gateway.callTool(name, args)
      } catch (error) {
        if (!(error instanceof AffinityUnavailableError)) throw error

        await ensureOpen()

        return gateway.callTool(name, args)
      }
    },
  }
}

async function tryConnect(gateway: AffinityGateway): Promise<string | undefined> {
  try {
    await gateway.connect()

    return undefined
  } catch (error) {
    return error instanceof Error ? error.message : String(error)
  }
}
