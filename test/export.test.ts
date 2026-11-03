import assert from "node:assert/strict"
import { test } from "node:test"
import { exportResultSchema, exportScript } from "../src/export.ts"
import { decodeScriptResult } from "../src/script-runtime.ts"

test("maps a format to its Affinity preset and defaults to the whole document", () => {
  const script = exportScript({ path: "/d/a.png", format: "png" })

  assert.ok(script.includes(`createWithPresetName("PNG")`))
  assert.ok(script.includes("FileExportArea.createForWholeDocument()"))
  assert.ok(script.includes(`doc.export("/d/a.png"`))
  assert.ok(script.includes("resolveDoc(null)"))
})

test("selects the requested area and target document", () => {
  const script = exportScript({ path: "/d/a.pdf", format: "pdf", area: "selection", session_uuid: "abc" })

  assert.ok(script.includes(`createWithPresetName("PDF (for export)")`))
  assert.ok(script.includes("FileExportArea.createForSelection(doc.selection)"))
  assert.ok(script.includes(`resolveDoc("abc")`))
})

test("embeds a hostile path as JSON so it cannot break out of the script", () => {
  const hostile = `/d/x"); evil(); ("`
  const script = exportScript({ path: hostile, format: "png" })

  assert.ok(script.includes(JSON.stringify(hostile)))
  assert.ok(!script.includes(`x"); evil()`))
})

test("decodes an export result payload", () => {
  const value = { ok: true, records: [{ path: "/d/a.png", ok: true, warning: "", error: "" }] }
  const result = { content: [{ type: "text" as const, text: `__affinity_mcp__:${JSON.stringify({ ok: true, value })}` }], isError: false }

  assert.deepEqual(decodeScriptResult(result, exportResultSchema), { ok: true, value })
})
