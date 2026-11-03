import assert from "node:assert/strict"
import { test } from "node:test"
import { SdkError, SdkErrorCode, type Transport } from "@modelcontextprotocol/client"
import { AffinityClient, AffinityUnavailableError, normalizeAffinityError } from "../src/affinity-client.ts"
import { createFakeAffinity } from "./fake-affinity.ts"

const url = "http://affinity.test/sse"

test("normalizes gateway failures into stable error codes", () => {
  assert.deepEqual(
    normalizeAffinityError(new SdkError(SdkErrorCode.RequestTimeout, "timed out")),
    { code: "AFFINITY_TIMEOUT", message: "timed out" },
  )
  assert.deepEqual(normalizeAffinityError(new Error("offline")), {
    code: "AFFINITY_UPSTREAM_ERROR",
    message: "offline",
  })
  assert.deepEqual(normalizeAffinityError(new AffinityUnavailableError(url, new Error("ECONNREFUSED"))), {
    code: "AFFINITY_UNAVAILABLE",
    message: `Affinity is not reachable at ${url} (ECONNREFUSED)`,
  })
})

test("connects lazily, reads the preamble once, and shares one session across concurrent calls", async () => {
  const affinity = createFakeAffinity()
  const client = new AffinityClient({ url, timeout: 1_000, createTransport: () => affinity.createTransport() })

  assert.deepEqual(client.status(), { state: "disconnected", url, reason: "not yet connected" })
  assert.equal(affinity.transports, 0)

  const [first, second] = await Promise.all([
    client.callTool("list_library_scripts", {}),
    client.callTool("list_library_scripts", {}),
  ])

  assert.equal(first.isError, false)
  assert.equal(second.isError, false)
  assert.equal(affinity.transports, 1)
  assert.deepEqual(client.status(), { state: "connected", url })
  assert.deepEqual(affinity.calls.map(({ name }) => name), [
    "read_sdk_documentation_topic",
    "list_library_scripts",
    "list_library_scripts",
  ])
  assert.deepEqual(affinity.calls[0]?.args, { filename: "preamble" })

  await client.close()
  assert.equal(client.status().state, "disconnected")
})

test("reports AFFINITY_UNAVAILABLE when the connector is unreachable and recovers once it appears", async () => {
  const affinity = createFakeAffinity()
  let reachable = false
  const client = new AffinityClient({
    url,
    timeout: 1_000,
    createTransport: () => {
      if (!reachable) throw new Error("connect ECONNREFUSED ::1:6767")

      return affinity.createTransport()
    },
  })

  await assert.rejects(client.callTool("list_library_scripts", {}), (error: unknown) => {
    assert.ok(error instanceof AffinityUnavailableError)
    assert.equal(normalizeAffinityError(error).code, "AFFINITY_UNAVAILABLE")

    return true
  })
  assert.deepEqual(client.status(), { state: "disconnected", url, reason: "connect ECONNREFUSED ::1:6767" })

  reachable = true
  await client.connect()
  assert.deepEqual(client.status(), { state: "connected", url })

  await client.close()
})

test("drops the session when the event stream errors and reconnects with a fresh preamble read", async () => {
  const affinity = createFakeAffinity()
  const client = new AffinityClient({ url, timeout: 1_000, createTransport: () => affinity.createTransport() })

  await client.connect()
  affinity.quit()
  assert.deepEqual(client.status(), {
    state: "disconnected",
    url,
    reason: "event stream failed: SSE error: TypeError: terminated",
  })

  const result = await client.callTool("list_library_scripts", {})

  assert.equal(result.isError, false)
  assert.equal(affinity.transports, 2)
  assert.deepEqual(affinity.calls.map(({ name }) => name), [
    "read_sdk_documentation_topic",
    "read_sdk_documentation_topic",
    "list_library_scripts",
  ])

  await client.close()
})

test("treats a failed send as Affinity being unavailable even when the stream stayed quiet", async () => {
  const affinity = createFakeAffinity()
  const client = new AffinityClient({
    url,
    timeout: 1_000,
    createTransport: () => {
      // Detach the error hook so only the POST failure can reveal the dead connector.
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

  await client.connect()
  affinity.quit()
  assert.equal(client.status().state, "connected")

  await assert.rejects(client.callTool("list_library_scripts", {}), (error: unknown) => {
    assert.ok(error instanceof AffinityUnavailableError)

    return true
  })
  assert.deepEqual(client.status(), {
    state: "disconnected",
    url,
    reason: "call to list_library_scripts failed: fetch failed",
  })

  await client.connect()
  assert.equal(affinity.transports, 2)

  await client.close()
})
