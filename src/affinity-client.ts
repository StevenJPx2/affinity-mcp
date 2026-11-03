import {
  Client,
  ProtocolError,
  SdkError,
  SdkErrorCode,
  SseError,
  SSEClientTransport,
  type Transport,
} from "@modelcontextprotocol/client"
import { readPositiveInteger } from "./env.ts"

export const UPSTREAM_TOOL_NAMES = [
  "add_sdk_hint",
  "execute_script",
  "list_library_scripts",
  "list_sdk_documentation",
  "read_library_script",
  "read_sdk_documentation_topic",
  "render_selection",
  "render_spread",
  "report_sdk_issue",
  "save_script_to_library",
  "search_sdk_hints",
] as const

export type AffinityToolName = (typeof UPSTREAM_TOOL_NAMES)[number]
export type AffinityToolResult = Awaited<ReturnType<Client["callTool"]>>

export type AffinityStatus =
  | { state: "disconnected"; url: string; reason: string }
  | { state: "connecting"; url: string }
  | { state: "connected"; url: string }

export interface AffinityGateway {
  status(): AffinityStatus
  connect(): Promise<void>
  callTool(name: AffinityToolName, args: Record<string, unknown>): Promise<AffinityToolResult>
  close(): Promise<void>
}

export type AffinityError = {
  code: "AFFINITY_ABORTED" | "AFFINITY_TIMEOUT" | "AFFINITY_UNAVAILABLE" | "AFFINITY_UPSTREAM_ERROR"
  message: string
}

export class AffinityUnavailableError extends Error {
  override readonly name = "AffinityUnavailableError"

  constructor(url: string, cause: unknown) {
    const detail = cause instanceof Error ? cause.message : String(cause)
    super(`Affinity is not reachable at ${url} (${detail})`, { cause })
  }
}

export interface AffinityClientOptions {
  url: string
  timeout: number
  createTransport?: () => Transport
}

type Session =
  | { state: "disconnected"; reason: string }
  | { state: "connecting"; ready: Promise<Client> }
  | { state: "connected"; client: Client }

export class AffinityClient implements AffinityGateway {
  private readonly url: string
  private readonly timeout: number
  private readonly createTransport: () => Transport
  private session: Session = { state: "disconnected", reason: "not yet connected" }

  constructor(options: AffinityClientOptions) {
    this.url = options.url
    this.timeout = options.timeout
    this.createTransport = options.createTransport ?? (() => new SSEClientTransport(new URL(this.url)))
  }

  static fromEnvironment(env: NodeJS.ProcessEnv = process.env): AffinityClient {
    return new AffinityClient({
      url: env.AFFINITY_MCP_URL ?? "http://localhost:6767/sse",
      timeout: readPositiveInteger(env, "AFFINITY_SCRIPT_TIMEOUT_MS", 300_000),
    })
  }

  status(): AffinityStatus {
    const session = this.session

    switch (session.state) {
      case "disconnected":
        return { state: "disconnected", url: this.url, reason: session.reason }
      case "connecting":
        return { state: "connecting", url: this.url }
      case "connected":
        return { state: "connected", url: this.url }
    }
  }

  async connect(): Promise<void> {
    await this.ensureClient()
  }

  async callTool(name: AffinityToolName, args: Record<string, unknown>): Promise<AffinityToolResult> {
    const client = await this.ensureClient()

    try {
      return await client.callTool({ name, arguments: args }, { timeout: this.timeout })
    } catch (error) {
      if (!isTransportFailure(error)) throw error

      await this.dropSession(client, `call to ${name} failed: ${describe(error)}`)
      throw new AffinityUnavailableError(this.url, error)
    }
  }

  async close(): Promise<void> {
    const session = this.session
    this.session = { state: "disconnected", reason: "closed by adapter" }

    if (session.state === "connected") await session.client.close()
    if (session.state === "connecting") await session.ready.then((client) => client.close(), () => {})
  }

  private ensureClient(): Promise<Client> {
    const session = this.session

    if (session.state === "connected") return Promise.resolve(session.client)
    if (session.state === "connecting") return session.ready

    const ready = this.openSession()
    this.session = { state: "connecting", ready }

    return ready
  }

  private async openSession(): Promise<Client> {
    const client = new Client(
      { name: "affinity-mcp", version: "0.1.0" },
      { versionNegotiation: { mode: "auto" } },
    )

    try {
      await client.connect(this.createTransport())

      const preamble = await client.callTool(
        { name: "read_sdk_documentation_topic", arguments: { filename: "preamble" } },
        { timeout: this.timeout },
      )

      if (preamble.isError) {
        throw new Error("Affinity rejected the required preamble read")
      }
    } catch (error) {
      await client.close().catch(() => {})
      this.session = { state: "disconnected", reason: describe(error) }
      throw new AffinityUnavailableError(this.url, error)
    }

    client.onclose = () => {
      if (this.session.state === "connected" && this.session.client === client) {
        this.session = { state: "disconnected", reason: "Affinity closed the connection" }
      }
    }
    // The legacy SSE transport reports a dead event stream through onerror, never onclose.
    client.onerror = (error) => {
      if (error instanceof SseError) void this.dropSession(client, `event stream failed: ${error.message}`)
    }
    this.session = { state: "connected", client }

    return client
  }

  private async dropSession(client: Client, reason: string): Promise<void> {
    if (this.session.state !== "connected" || this.session.client !== client) return

    this.session = { state: "disconnected", reason }
    await client.close().catch(() => {})
  }
}

function isTransportFailure(error: unknown): boolean {
  if (error instanceof ProtocolError) return false
  if (error instanceof SdkError) return error.code !== SdkErrorCode.RequestTimeout
  if (error instanceof Error && error.name === "AbortError") return false

  return true
}

export function normalizeAffinityError(error: unknown): AffinityError {
  if (error instanceof AffinityUnavailableError) {
    return { code: "AFFINITY_UNAVAILABLE", message: error.message }
  }

  if (error instanceof SdkError && error.code === SdkErrorCode.RequestTimeout) {
    return { code: "AFFINITY_TIMEOUT", message: error.message }
  }

  if (error instanceof Error && error.name === "AbortError") {
    return { code: "AFFINITY_ABORTED", message: error.message }
  }

  return { code: "AFFINITY_UPSTREAM_ERROR", message: describe(error) }
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
