import assert from "node:assert/strict"
import { test } from "node:test"
import {
  documentSettingsSchema,
  getDocumentSettingsScript,
  setDocumentSettingsScript,
} from "../src/document-settings.ts"
import { decodeScriptResult } from "../src/script-runtime.ts"

const settings = {
  session_uuid: "u-1",
  title: "poster.afdesign",
  path: "/d/poster.afdesign",
  width_pixels: 1024,
  height_pixels: 768,
  dpi: 300,
  units: "Millimetre",
  colour_format: "RGBA8",
  colour_profile: "sRGB IEC61966-2.1",
  mask_format: "M8",
  layer_count: 4,
  artboard_count: 0,
  has_artboards: false,
  fonts: ["Helvetica"],
  is_dirty: true,
  can_undo: true,
  can_redo: false,
}
const textResult = (text: string) => ({ content: [{ type: "text" as const, text }], isError: false })

test("get-settings targets the current document by default and a specific one when given a uuid", () => {
  assert.ok(getDocumentSettingsScript().includes("resolveDoc(null)"))
  assert.ok(getDocumentSettingsScript("abc-123").includes(`resolveDoc("abc-123")`))
})

test("get-settings decodes a full settings payload, including a null colour profile", () => {
  const result = textResult(`__affinity_mcp__:${JSON.stringify({ ok: true, value: { ...settings, colour_profile: null } })}`)
  const outcome = decodeScriptResult(result, documentSettingsSchema)

  assert.ok(outcome.ok)
  assert.equal(outcome.ok && outcome.value.colour_profile, null)
})

test("set-settings changes units through the dedicated command without a properties block", () => {
  const script = setDocumentSettingsScript({ units: "Inch" })

  assert.ok(script.includes(`doc.units = UnitType["Inch"];`))
  assert.ok(!script.includes("DocumentProperties.create()"))
})

test("set-settings seeds document properties from the current document and overrides only requested fields", () => {
  const script = setDocumentSettingsScript({ dpi: 150 })

  assert.ok(script.includes("DocumentProperties.create()"))
  assert.ok(script.includes("props.dpi = 150;"))
  assert.ok(script.includes("width: size.width,"))
  assert.ok(script.includes("height: size.height,"))
  assert.ok(script.includes("props.setColourFormatAndProfile(doc.format, doc.colourProfile);"))
  assert.ok(!script.includes("props.isTransparent"))
})

test("set-settings applies explicit dimensions and transparency", () => {
  const script = setDocumentSettingsScript({ width_pixels: 2000, height_pixels: 1000, transparent_background: true })

  assert.ok(script.includes("width: 2000,"))
  assert.ok(script.includes("height: 1000,"))
  assert.ok(script.includes("props.dpi = doc.dpi;"))
  assert.ok(script.includes("props.isTransparent = true;"))
})

test("set-settings embeds a hostile uuid as JSON so it cannot break out of the script", () => {
  const hostile = `x"); doSomethingEvil(); ("`
  const script = setDocumentSettingsScript({ session_uuid: hostile, dpi: 72 })

  assert.ok(script.includes(`resolveDoc(${JSON.stringify(hostile)})`))
  // The raw breakout sequence (unescaped quote) must not appear as executable code.
  assert.ok(!script.includes('x"); doSomethingEvil'))
})
