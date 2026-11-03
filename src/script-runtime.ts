import * as z from "zod/v4"
import type { AffinityToolResult } from "./affinity-client.ts"

export type ScriptOutcome<T> = { ok: true; value: T } | { ok: false; error: string }

const MARKER = "__affinity_mcp__:"

// Affinity reports uncaught script exceptions as ordinary text with isError=false, so every
// generated script prints exactly one marker line and the adapter reads success from that.
export function buildScript(requires: string, body: string): string {
  return `${requires}
function finish(value) { console.log(${JSON.stringify(MARKER)} + JSON.stringify({ ok: true, value })); }
function fail(error) { console.log(${JSON.stringify(MARKER)} + JSON.stringify({ ok: false, error: String(error) })); }
try {
${body}
} catch (error) { fail(error); }
`
}

export function decodeScriptResult<T>(result: AffinityToolResult, schema: z.ZodType<T>): ScriptOutcome<T> {
  const text = result.content
    .flatMap((block) => (block.type === "text" ? [block.text] : []))
    .join("\n")

  if (result.isError) return { ok: false, error: text || "Affinity rejected the script" }

  const line = text.split("\n").find((candidate) => candidate.startsWith(MARKER))
  if (line === undefined) return { ok: false, error: `Script did not complete: ${text.trim()}` }

  const outcome = z.union([
    z.object({ ok: z.literal(true), value: schema }),
    z.object({ ok: z.literal(false), error: z.string() }),
  ]).safeParse(JSON.parse(line.slice(MARKER.length)))

  if (!outcome.success) return { ok: false, error: `Unexpected script output: ${outcome.error.message}` }

  return outcome.data
}
