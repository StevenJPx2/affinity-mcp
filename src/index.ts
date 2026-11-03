#!/usr/bin/env node
import { serveStdio } from "@modelcontextprotocol/server/stdio"
import { AffinityClient } from "./affinity-client.ts"
import { createLauncher, readOpenOptions } from "./affinity-launcher.ts"
import { createAffinityServer } from "./server.ts"

function main(): void {
  const gateway = AffinityClient.fromEnvironment()
  const deps = { gateway, launcher: createLauncher(), open: readOpenOptions() }
  const handle = serveStdio(() => createAffinityServer(deps), {
    onerror: (error) => console.error(`[affinity-mcp] ${error.message}`),
  })
  let closing: Promise<void> | undefined

  const shutdown = (exitCode?: number) => {
    if (exitCode !== undefined) process.exitCode = exitCode
    closing ??= Promise.allSettled([handle.close(), gateway.close()]).then(() => undefined)

    return closing
  }

  process.once("SIGINT", () => void shutdown(130))
  process.once("SIGTERM", () => void shutdown(143))
  process.stdin.once("end", () => void shutdown())

  gateway.connect().then(
    () => console.error(`[affinity-mcp] connected to Affinity at ${gateway.status().url}`),
    (error: unknown) => console.error(`[affinity-mcp] ${error instanceof Error ? error.message : String(error)}`),
  )
}

try {
  main()
} catch (error: unknown) {
  console.error(`[affinity-mcp] ${error instanceof Error ? error.message : String(error)}`)
  process.exitCode = 1
}
