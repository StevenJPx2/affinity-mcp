import assert from "node:assert/strict"
import { test } from "node:test"
import {
  addNodeResultSchema,
  addShapeScript,
  addTextScript,
  placeImageInput,
  placeImageScript,
} from "../src/primitives.ts"
import { decodeScriptResult } from "../src/script-runtime.ts"

test("add-shape builds a rectangle with the given bounds and no fill by default", () => {
  const script = addShapeScript({ kind: "rectangle", x: 10, y: 20, width: 300, height: 200 })

  assert.ok(script.includes("ShapeRectangle.create()"))
  assert.ok(script.includes("new Rectangle(10, 20, 300, 200)"))
  assert.ok(script.includes("const fill = null;"))
  assert.ok(script.includes("resolveDoc(null)"))
})

test("add-shape converts a hex fill to unit-float RGBA and targets a document", () => {
  const opaque = addShapeScript({ kind: "ellipse", x: 0, y: 0, width: 1, height: 1, fill: "#ff8000", session_uuid: "abc" })
  assert.ok(opaque.includes("ShapeEllipse.create()"))
  assert.ok(opaque.includes("Colour.createRGBAuf([1.000000, 0.501961, 0.000000, 1.000000])"))
  assert.ok(opaque.includes(`resolveDoc("abc")`))

  const alpha = addShapeScript({ kind: "rectangle", x: 0, y: 0, width: 1, height: 1, fill: "#00000080" })
  assert.ok(alpha.includes("Colour.createRGBAuf([0.000000, 0.000000, 0.000000, 0.501961])"))
})

test("add-text embeds text as JSON and builds a frame from a story builder", () => {
  const hostile = `Hi"); evil(); ("`
  const script = addTextScript({ text: hostile, x: 5, y: 6, width: 100, height: 40 })

  assert.ok(script.includes("StoryBuilder.create()"))
  assert.ok(script.includes("FrameTextNodeDefinition.createFromStoryBuilder(new Rectangle(5, 6, 100, 40), sb)"))
  assert.ok(script.includes(`sb.addText(${JSON.stringify(hostile)})`))
  assert.ok(!script.includes(`Hi"); evil()`))
  assert.ok(!script.includes("addBrushFillDescriptor"))
})

test("place-image fits to a rectangle via a transform when bounds are given", () => {
  const script = placeImageScript({ image_path: "/d/pic.png", x: 50, y: 60, width: 200, height: 150 })

  assert.ok(script.includes(`Bitmap.loadFromFile("/d/pic.png")`))
  assert.ok(script.includes("Transform.createTranslate(50, 60)"))
  assert.ok(script.includes("Transform.createScale(200 / bm.width, 150 / bm.height)"))
})

test("place-image omits the transform when no bounds are given (natural size)", () => {
  const script = placeImageScript({ image_path: "/d/pic.png" })

  assert.ok(script.includes(`Bitmap.loadFromFile("/d/pic.png")`))
  assert.ok(!script.includes("setTransform"))
})

test("place-image rejects a partial rectangle", () => {
  assert.equal(placeImageInput.safeParse({ image_path: "/d/pic.png", x: 5, y: 5 }).success, false)
  assert.equal(placeImageInput.safeParse({ image_path: "/d/pic.png" }).success, true)
  assert.equal(placeImageInput.safeParse({ image_path: "/d/pic.png", x: 5, y: 5, width: 10, height: 10 }).success, true)
})

test("decodes an add-node result", () => {
  const value = { session_uuid: "u-1", layer_count: 2 }
  const result = { content: [{ type: "text" as const, text: `__affinity_mcp__:${JSON.stringify({ ok: true, value })}` }], isError: false }

  assert.deepEqual(decodeScriptResult(result, addNodeResultSchema), { ok: true, value })
})
