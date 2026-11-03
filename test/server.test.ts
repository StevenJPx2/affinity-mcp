import assert from "node:assert/strict"
import { test } from "node:test"
import { Client, StreamableHTTPClientTransport } from "@modelcontextprotocol/client"
import type { AffinityGateway, AffinityStatus, AffinityToolName, AffinityToolResult } from "../src/affinity-client.ts"
import { createAffinityMcpHandler } from "../src/server.ts"

const url = "http://affinity.test/sse"

test("lists and delegates all Affinity tools over MCP", async () => {
  const calls: Array<{ name: AffinityToolName; args: Record<string, unknown> }> = []
  const image = { type: "image" as const, data: "aGVsbG8=", mimeType: "image/jpeg" }
  let launched = 0
  let status: AffinityStatus = { state: "disconnected", url, reason: "not yet connected" }
  const gateway: AffinityGateway = {
    status: () => status,
    async connect() {
      if (launched === 0) throw new Error("ECONNREFUSED")
      status = { state: "connected", url }
    },
    async callTool(name, args): Promise<AffinityToolResult> {
      calls.push({ name, args })
      if (name === "render_spread") return { content: [image], isError: false }
      if (name === "execute_script") {
        const script = String(args.script)
        if (script.includes("Document.load(")) {
          const value = { session_uuid: "u-1", title: "poster.afdesign", path: "/d/poster.afdesign", is_dirty: false, is_current: true }
          return { content: [{ type: "text", text: `__affinity_mcp__:${JSON.stringify({ ok: true, value })}` }], isError: false }
        }
        if (script.includes("DocumentPreset.all.find(")) {
          return { content: [{ type: "text", text: `__affinity_mcp__:${JSON.stringify({ ok: false, error: "Unknown preset Z9" })}` }], isError: false }
        }
        if (script.includes("readSettings(doc)")) {
          const value = {
            session_uuid: "u-1", title: "poster.afdesign", path: "/d/poster.afdesign",
            width_pixels: script.includes("width: 2048") ? 2048 : 1024, height_pixels: 768,
            dpi: script.includes("props.dpi = 300") ? 300 : 72,
            units: script.includes('UnitType["Inch"]') ? "Inch" : "Pixel",
            colour_format: "RGBA8", colour_profile: "sRGB IEC61966-2.1", mask_format: "M8",
            layer_count: 3, artboard_count: 0, has_artboards: false, fonts: ["Helvetica"],
            is_dirty: false, can_undo: false, can_redo: false,
          }
          return { content: [{ type: "text", text: `__affinity_mcp__:${JSON.stringify({ ok: true, value })}` }], isError: false }
        }
        if (script.includes("doc.export(")) {
          const value = { ok: true, records: [{ path: "/d/out.png", ok: true, warning: "", error: "" }] }
          return { content: [{ type: "text", text: `__affinity_mcp__:${JSON.stringify({ ok: true, value })}` }], isError: false }
        }
        if (script.includes("doc.addNode(")) {
          const value = { session_uuid: "u-1", layer_count: 1 }
          return { content: [{ type: "text", text: `__affinity_mcp__:${JSON.stringify({ ok: true, value })}` }], isError: false }
        }
        throw new Error("Affinity unavailable")
      }
      return { content: [{ type: "text", text: "upstream error" }], isError: true }
    },
    async close() {},
  }
  const handler = createAffinityMcpHandler({
    gateway,
    launcher: { async launch() { launched += 1 } },
    open: { timeoutMs: 500, pollMs: 5 },
  })
  const client = new Client(
    { name: "affinity-mcp-test", version: "0.0.0" },
    { versionNegotiation: { mode: "auto" } },
  )
  const transport = new StreamableHTTPClientTransport(new URL("http://affinity.test/mcp"), {
    fetch: (url, init) => handler.fetch(new Request(url, init)),
  })

  await client.connect(transport)

  try {
    const listed = await client.listTools()
    assert.equal(listed.tools.length, 22)
    assert.deepEqual(listed.tools.map(({ name }) => name), [
      "affinity_status",
      "affinity_open",
      "affinity_list_documents",
      "affinity_new_document",
      "affinity_open_document",
      "affinity_get_document_settings",
      "affinity_set_document_settings",
      "affinity_export",
      "affinity_add_shape",
      "affinity_add_text",
      "affinity_place_image",
      "affinity_add_sdk_hint",
      "affinity_execute_script",
      "affinity_list_library_scripts",
      "affinity_list_sdk_documentation",
      "affinity_read_library_script",
      "affinity_read_sdk_documentation_topic",
      "affinity_render_selection",
      "affinity_render_spread",
      "affinity_report_sdk_issue",
      "affinity_save_script_to_library",
      "affinity_search_sdk_hints",
    ])

    const execute = listed.tools.find(({ name }) => name === "affinity_execute_script")
    assert.deepEqual(execute?.annotations, {
      readOnlyHint: false,
      destructiveHint: true,
      idempotentHint: false,
    })
    assert.deepEqual(execute?.inputSchema.required, ["script"])
    assert.equal(execute?.inputSchema.additionalProperties, false)

    const before = await client.callTool({ name: "affinity_status", arguments: {} })
    assert.equal(before.isError, false)
    assert.deepEqual(before.structuredContent, { state: "disconnected", url, reason: "not yet connected" })
    assert.equal(launched, 0)

    const render = await client.callTool({
      name: "affinity_render_spread",
      arguments: {
        document_session_uuid: "123e4567-e89b-42d3-a456-426614174000",
        spread_index: 2,
      },
    })
    assert.deepEqual(render.content, [image])
    assert.equal(render.isError, false)
    assert.equal(launched, 1, "an upstream tool call launches Affinity when it is not running")
    assert.deepEqual(status, { state: "connected", url })

    const warm = await client.callTool({ name: "affinity_open", arguments: {} })
    assert.equal(warm.isError, false)
    assert.equal(launched, 1, "affinity_open is a no-op once connected")
    assert.deepEqual(calls[0], {
      name: "render_spread",
      args: {
        document_session_uuid: "123e4567-e89b-42d3-a456-426614174000",
        spread_index: 2,
      },
    })

    const opened = await client.callTool({ name: "affinity_open_document", arguments: { path: "/d/poster.afdesign" } })
    assert.equal(opened.isError, false)
    assert.deepEqual(opened.structuredContent, {
      session_uuid: "u-1", title: "poster.afdesign", path: "/d/poster.afdesign", is_dirty: false, is_current: true,
    })
    assert.equal(calls.at(-1)?.name, "execute_script")

    const settings = await client.callTool({ name: "affinity_get_document_settings", arguments: {} })
    assert.equal(settings.isError, false)
    assert.equal((settings.structuredContent as { dpi: number }).dpi, 72)
    assert.equal((settings.structuredContent as { units: string }).units, "Pixel")

    const changed = await client.callTool({
      name: "affinity_set_document_settings",
      arguments: { dpi: 300, width_pixels: 2048, units: "Inch" },
    })
    assert.equal(changed.isError, false)
    assert.deepEqual(
      { dpi: (changed.structuredContent as { dpi: number }).dpi, units: (changed.structuredContent as { units: string }).units, width: (changed.structuredContent as { width_pixels: number }).width_pixels },
      { dpi: 300, units: "Inch", width: 2048 },
    )
    const setScript = String(calls.at(-1)?.args.script)
    assert.ok(setScript.includes(`doc.units = UnitType["Inch"];`))
    assert.ok(setScript.includes("props.dpi = 300;"))
    assert.ok(setScript.includes("width: 2048,"))

    const noChange = await client.callTool({ name: "affinity_set_document_settings", arguments: {} })
    assert.equal(noChange.isError, true)

    const exported = await client.callTool({
      name: "affinity_export",
      arguments: { path: "/d/out.png", format: "png" },
    })
    assert.equal(exported.isError, false)
    assert.equal((exported.structuredContent as { ok: boolean }).ok, true)
    assert.ok(String(calls.at(-1)?.args.script).includes(`createWithPresetName("PNG")`))

    const shape = await client.callTool({
      name: "affinity_add_shape",
      arguments: { kind: "ellipse", x: 10, y: 20, width: 100, height: 50, fill: "#ff0000" },
    })
    assert.equal(shape.isError, false)
    assert.deepEqual(shape.structuredContent, { session_uuid: "u-1", layer_count: 1 })
    const shapeScript = String(calls.at(-1)?.args.script)
    assert.ok(shapeScript.includes("ShapeEllipse.create()"))
    assert.ok(shapeScript.includes("Colour.createRGBAuf([1.000000, 0.000000, 0.000000, 1.000000])"))

    const text = await client.callTool({
      name: "affinity_add_text",
      arguments: { text: "Hi", x: 0, y: 0, width: 200, height: 40 },
    })
    assert.equal(text.isError, false)
    assert.ok(String(calls.at(-1)?.args.script).includes(`sb.addText("Hi")`))

    const placed = await client.callTool({
      name: "affinity_place_image",
      arguments: { image_path: "/d/pic.png", x: 5, y: 5, width: 80, height: 80 },
    })
    assert.equal(placed.isError, false)
    assert.ok(String(calls.at(-1)?.args.script).includes("Bitmap.loadFromFile"))

    const badRect = await client.callTool({
      name: "affinity_place_image",
      arguments: { image_path: "/d/pic.png", x: 5 },
    })
    assert.equal(badRect.isError, true)

    const badPreset = await client.callTool({ name: "affinity_new_document", arguments: { preset: "Z9" } })
    assert.equal(badPreset.isError, true)
    assert.deepEqual(badPreset.structuredContent, { code: "AFFINITY_SCRIPT_ERROR", message: "Unknown preset Z9" })

    const invalid = await client.callTool({ name: "affinity_new_document", arguments: { width: 100 } })
    assert.equal(invalid.isError, true)

    const upstreamError = await client.callTool({ name: "affinity_list_library_scripts", arguments: {} })
    assert.equal(upstreamError.isError, true)
    assert.equal(upstreamError.content[0]?.type, "text")

    const thrown = await client.callTool({
      name: "affinity_execute_script",
      arguments: { script: "console.log('hello')" },
    })
    assert.equal(thrown.isError, true)
    assert.deepEqual(thrown.structuredContent, {
      code: "AFFINITY_UPSTREAM_ERROR",
      message: "Affinity unavailable",
    })
    assert.equal(thrown.content[0]?.type, "text")
    assert.deepEqual(JSON.parse(thrown.content[0]?.type === "text" ? thrown.content[0].text : ""), thrown.structuredContent)
  } finally {
    await client.close()
  }
})
