import assert from "node:assert/strict"
import { test } from "node:test"
import * as z from "zod/v4"
import { documentInfoSchema, newDocumentScript, openDocumentScript } from "../src/documents.ts"
import { decodeScriptResult } from "../src/script-runtime.ts"

const info = {
  session_uuid: "B8D6A08A-710B-432F-BA78-5F17E1DB1154",
  title: "poster.afdesign",
  path: "/Users/me/Desktop/poster.afdesign",
  is_dirty: false,
  is_current: true,
}
const textResult = (text: string, isError = false) => ({ content: [{ type: "text" as const, text }], isError })

test("decodes a successful marker line even when other console output precedes it", () => {
  const result = textResult(`debug noise\n__affinity_mcp__:${JSON.stringify({ ok: true, value: info })}\n`)

  assert.deepEqual(decodeScriptResult(result, documentInfoSchema), { ok: true, value: info })
})

test("decodes a script-side failure into an error outcome", () => {
  const result = textResult(`__affinity_mcp__:${JSON.stringify({ ok: false, error: "Error: PERMISSION_DENIED" })}`)

  assert.deepEqual(decodeScriptResult(result, documentInfoSchema), { ok: false, error: "Error: PERMISSION_DENIED" })
})

test("treats a thrown script (no marker, isError=false) as a failure with the raw output", () => {
  // Affinity reports uncaught script exceptions as ordinary text, not isError.
  const result = textResult("before\nError: boom\n    at main:2:7\n")

  assert.deepEqual(decodeScriptResult(result, documentInfoSchema), {
    ok: false,
    error: "Script did not complete: before\nError: boom\n    at main:2:7",
  })
})

test("rejects marker payloads that do not match the expected shape", () => {
  const result = textResult(`__affinity_mcp__:${JSON.stringify({ ok: true, value: { nope: 1 } })}`)
  const outcome = decodeScriptResult(result, z.object({ count: z.number() }))

  assert.equal(outcome.ok, false)
  assert.ok(!outcome.ok && outcome.error.startsWith("Unexpected script output"))
})

test("propagates connector-level isError results", () => {
  assert.deepEqual(decodeScriptResult(textResult("NOT_ALLOWED", true), documentInfoSchema), {
    ok: false,
    error: "NOT_ALLOWED",
  })
})

test("embeds user input as JSON so quotes and backslashes cannot break out of the script", () => {
  const hostile = `'); console.log("pwned"); //\\`
  const script = openDocumentScript(hostile)

  assert.ok(script.includes(`const path = ${JSON.stringify(hostile)};`))
  assert.ok(!script.includes(`console.log("pwned")`))

  const presetScript = newDocumentScript({ preset: hostile, save_as: hostile })
  assert.ok(presetScript.includes(`p.name === ${JSON.stringify(hostile)}`))
  assert.ok(presetScript.includes(`doc.saveAs(${JSON.stringify(hostile)});`))
})

test("builds a custom-size script that sets validated units and optional dpi", () => {
  const script = newDocumentScript({ width: 800, height: 600, units: "Pixel", dpi: 72 })

  assert.ok(script.includes(`options.units = UnitType["Pixel"];`))
  assert.ok(script.includes("options.width = 800;"))
  assert.ok(script.includes("options.height = 600;"))
  assert.ok(script.includes("options.dpi = 72;"))
  assert.ok(!newDocumentScript({ width: 1, height: 1, units: "Inch" }).includes("options.dpi"))
})
