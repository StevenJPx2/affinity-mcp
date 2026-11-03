import assert from "node:assert/strict"
import { test } from "node:test"
import type { Transport } from "@modelcontextprotocol/client"
import { AffinityClient, AffinityUnavailableError } from "../src/affinity-client.ts"
import {
  createLauncher,
  openAffinity,
  readOpenOptions,
  withAutoOpen,
  type AffinityLauncher,
} from "../src/affinity-launcher.ts"
import { createFakeAffinity } from "./fake-affinity.ts"

const url = "http://affinity.test/sse"
const options = { timeoutMs: 500, pollMs: 5 }

test("launches Affinity, waits for the connector, and connects", async () => {
  const affinity = createFakeAffinity()
  let launched = 0
  let reachable = false
  const launcher: AffinityLauncher = {
    async launch() {
      launched += 1
      setTimeout(() => { reachable = true }, 20)
    },
  }
  const client = new AffinityClient({
    url,
    timeout: 1_000,
    createTransport: () => {
      if (!reachable) throw new Error("ECONNREFUSED")

      return affinity.createTransport()
    },
  })

  const status = await openAffinity(client, launcher, options)

  assert.deepEqual(status, { state: "connected", url })
  assert.equal(launched, 1)
  assert.equal(affinity.transports, 1)

  const again = await openAffinity(client, launcher, options)

  assert.deepEqual(again, { state: "connected", url })
  assert.equal(launched, 1)

  await client.close()
})

test("gives up with the last failure once the launch timeout passes", async () => {
  const client = new AffinityClient({
    url,
    timeout: 1_000,
    createTransport: () => { throw new Error("ECONNREFUSED") },
  })
  const launcher: AffinityLauncher = { async launch() {} }

  const status = await openAffinity(client, launcher, { timeoutMs: 30, pollMs: 5 })

  assert.equal(status.state, "disconnected")
  assert.ok(status.state === "disconnected" && status.reason.includes("ECONNREFUSED"))
})

test("reconnects to a running Affinity without launching it", async () => {
  const affinity = createFakeAffinity()
  let launched = 0
  const launcher: AffinityLauncher = { async launch() { launched += 1 } }
  const client = new AffinityClient({ url, timeout: 1_000, createTransport: () => affinity.createTransport() })

  await client.connect()
  affinity.quit()
  assert.equal(client.status().state, "disconnected")

  const status = await openAffinity(client, launcher, options)

  assert.deepEqual(status, { state: "connected", url })
  assert.equal(launched, 0)
  assert.equal(affinity.transports, 2)

  await client.close()
})

test("withAutoOpen launches Affinity before the first upstream call and retries once after a stale session", async () => {
  const affinity = createFakeAffinity()
  let launched = 0
  let reachable = false
  const launcher: AffinityLauncher = {
    async launch() {
      launched += 1
      reachable = true
    },
  }
  const client = new AffinityClient({
    url,
    timeout: 1_000,
    createTransport: () => {
      if (!reachable) throw new Error("ECONNREFUSED")

      // Detach the error hook so the quit is only visible through a failed send.
      const inner = affinity.createTransport()
      const transport: Transport = {
        start: () => inner.start(),
        send: (message) => inner.send(message),
        close: () => inner.close(),
      }
      inner.onmessage = (message) => transport.onmessage?.(message)

      return transport
    },
  })
  const gateway = withAutoOpen(client, launcher, options)

  const first = await gateway.callTool("list_library_scripts", {})
  assert.equal(first.isError, false)
  assert.equal(launched, 1)
  assert.equal(affinity.transports, 1)

  affinity.quit()
  assert.equal(client.status().state, "connected", "quit is invisible until a send fails")

  const second = await gateway.callTool("list_library_scripts", {})
  assert.equal(second.isError, false)
  assert.equal(affinity.transports, 2)
  assert.equal(launched, 1, "reconnect succeeded, so no relaunch")

  await gateway.close()
})

test("withAutoOpen surfaces AFFINITY_UNAVAILABLE when launch never yields a connector", async () => {
  const client = new AffinityClient({
    url,
    timeout: 1_000,
    createTransport: () => { throw new Error("ECONNREFUSED") },
  })
  const gateway = withAutoOpen(client, { async launch() {} }, { timeoutMs: 20, pollMs: 5 })

  await assert.rejects(gateway.callTool("list_library_scripts", {}), (error: unknown) => {
    assert.ok(error instanceof AffinityUnavailableError)
    assert.match(error.message, /ECONNREFUSED/)

    return true
  })
})

test("refuses to launch on platforms without the macOS open command", async () => {
  await assert.rejects(createLauncher({}, "linux").launch(), /only supported on macOS/)
})

test("reads launch options from the environment", () => {
  assert.deepEqual(readOpenOptions({}), { timeoutMs: 120_000, pollMs: 1_000 })
  assert.deepEqual(readOpenOptions({ AFFINITY_LAUNCH_TIMEOUT_MS: "5000" }), { timeoutMs: 5_000, pollMs: 1_000 })
  assert.throws(() => readOpenOptions({ AFFINITY_LAUNCH_TIMEOUT_MS: "soon" }), /positive integer/)
})
