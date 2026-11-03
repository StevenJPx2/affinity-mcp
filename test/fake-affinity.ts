import { SseError } from "@modelcontextprotocol/client"
import { InMemoryTransport, McpServer, type JSONRPCMessage, type Transport } from "@modelcontextprotocol/server"
import * as z from "zod/v4"

export interface FakeAffinity {
  calls: Array<{ name: string; args: Record<string, unknown> }>
  transports: number
  createTransport(): Transport
  /** Affinity quits: POSTs start failing and the event stream errors, but nothing calls onclose. */
  quit(): void
}

export function createFakeAffinity(): FakeAffinity {
  const calls: FakeAffinity["calls"] = []
  let current: SseLikeTransport | undefined

  const fake: FakeAffinity = {
    calls,
    transports: 0,
    createTransport() {
      fake.transports += 1
      const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair()
      void createFakeServer(calls).connect(serverTransport)
      current = new SseLikeTransport(clientTransport)

      return current
    },
    quit() {
      current?.quit()
    },
  }

  return fake
}

class SseLikeTransport implements Transport {
  onclose?: () => void
  onerror?: (error: Error) => void
  onmessage?: (message: JSONRPCMessage) => void
  private alive = true

  constructor(private readonly inner: Transport) {
    inner.onmessage = (message) => this.onmessage?.(message)
  }

  async start(): Promise<void> {
    await this.inner.start()
  }

  async send(message: JSONRPCMessage): Promise<void> {
    if (!this.alive) throw new TypeError("fetch failed")
    await this.inner.send(message)
  }

  async close(): Promise<void> {
    await this.inner.close()
    this.onclose?.()
  }

  quit(): void {
    this.alive = false
    this.onerror?.(new SseError(undefined, "TypeError: terminated", new ErrorEvent("error")))
  }
}

function createFakeServer(calls: FakeAffinity["calls"]): McpServer {
  const server = new McpServer({ name: "Affinity", version: "1.0.0" }, { capabilities: { tools: {} } })
  const text = (value: string) => ({ content: [{ type: "text" as const, text: value }], isError: false })

  server.registerTool("read_sdk_documentation_topic", {
    inputSchema: z.object({ filename: z.string() }),
  }, (args) => {
    calls.push({ name: "read_sdk_documentation_topic", args })

    return text(`doc:${args.filename}`)
  })

  server.registerTool("list_library_scripts", {
    inputSchema: z.object({}),
  }, (args) => {
    calls.push({ name: "list_library_scripts", args })

    return text("scripts")
  })

  return server
}
