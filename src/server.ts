import { McpServer, createMcpHandler } from "@modelcontextprotocol/server"
import * as z from "zod/v4"
import {
  normalizeAffinityError,
  type AffinityGateway,
  type AffinityStatus,
  type AffinityToolName,
  type AffinityToolResult,
} from "./affinity-client.ts"
import { openAffinity, withAutoOpen, type AffinityLauncher, type OpenOptions } from "./affinity-launcher.ts"
import {
  DOCUMENT_UNITS,
  documentInfoSchema,
  listDocumentsScript,
  newDocumentScript,
  openDocumentScript,
} from "./documents.ts"
import {
  documentSettingsSchema,
  getDocumentSettingsScript,
  setDocumentSettingsScript,
  type SetDocumentSettingsInput,
} from "./document-settings.ts"
import { EXPORT_FORMATS, EXPORT_AREAS_LIST, exportResultSchema, exportScript, type ExportInput } from "./export.ts"
import {
  addNodeResultSchema,
  addShapeInput,
  addShapeScript,
  addTextInput,
  addTextScript,
  placeImageInput,
  placeImageScript,
  type AddShapeInput,
  type AddTextInput,
  type PlaceImageInput,
} from "./primitives.ts"
import { decodeScriptResult, type ScriptOutcome } from "./script-runtime.ts"

export interface AffinityServerDependencies {
  gateway: AffinityGateway
  launcher: AffinityLauncher
  open: OpenOptions
}

const emptyInput = z.object({}).strict()
const hintInput = z.object({ hint: z.string().min(1) }).strict()
const scriptInput = z.object({ script: z.string().min(1) }).strict()
const titleInput = z.object({ title: z.string().min(1) }).strict()
const documentationInput = z.object({ filename: z.string().min(1) }).strict()
const documentInput = z.object({ document_session_uuid: z.string().uuid() }).strict()
const spreadInput = z.object({
  document_session_uuid: z.string().uuid(),
  spread_index: z.number().int().nonnegative(),
}).strict()
const issueInput = z.object({
  description: z.string().min(1),
  code: z.string().min(1).optional(),
}).strict()
const savedScriptInput = z.object({
  title: z.string().min(1),
  description: z.string().min(1),
  code: z.string().min(1),
}).strict()
const searchInput = z.object({ prompt: z.string().min(1) }).strict()
const pathInput = z.object({ path: z.string().min(1) }).strict()
const newDocumentInput = z.union([
  z.object({
    preset: z.string().min(1),
    save_as: z.string().min(1).optional(),
  }).strict(),
  z.object({
    width: z.number().positive(),
    height: z.number().positive(),
    units: z.enum(DOCUMENT_UNITS),
    dpi: z.number().positive().optional(),
    save_as: z.string().min(1).optional(),
  }).strict(),
])
const documentListSchema = z.object({ documents: z.array(documentInfoSchema) })
const sessionUuidInput = z.object({ session_uuid: z.string().uuid().optional() }).strict()
const setDocumentSettingsInput = z.object({
  session_uuid: z.string().uuid().optional(),
  units: z.enum(DOCUMENT_UNITS).optional(),
  dpi: z.number().positive().optional(),
  width_pixels: z.number().int().positive().optional(),
  height_pixels: z.number().int().positive().optional(),
  transparent_background: z.boolean().optional(),
}).strict().refine(
  (value) => Object.keys(value).some((key) => key !== "session_uuid"),
  { message: "Provide at least one setting to change" },
)
const exportInput = z.object({
  path: z.string().min(1),
  format: z.enum(EXPORT_FORMATS),
  area: z.enum(EXPORT_AREAS_LIST).optional(),
  session_uuid: z.string().uuid().optional(),
}).strict()

const readOnly = { readOnlyHint: true, destructiveHint: false, idempotentHint: true } as const
const additive = { readOnlyHint: false, destructiveHint: false, idempotentHint: false } as const
const destructive = { readOnlyHint: false, destructiveHint: true, idempotentHint: false } as const

export function createAffinityServer(deps: AffinityServerDependencies): McpServer {
  const gateway = withAutoOpen(deps.gateway, deps.launcher, deps.open)
  const server = new McpServer(
    { name: "affinity-mcp", version: "0.1.0" },
    { capabilities: { tools: {} } },
  )

  server.registerTool("affinity_status", {
    description: "Report whether the adapter is connected to Affinity's local MCP connector. Does not launch Affinity.",
    inputSchema: emptyInput,
    annotations: readOnly,
  }, () => statusResult(gateway.status()))

  server.registerTool("affinity_open", {
    description: "Launch Affinity if it is not running, wait for its local MCP connector, and connect. Other tools do this automatically; use this to warm Affinity up ahead of time.",
    inputSchema: emptyInput,
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true },
  }, async () => {
    try {
      const status = await openAffinity(deps.gateway, deps.launcher, deps.open)

      return { ...statusResult(status), isError: status.state !== "connected" }
    } catch (error) {
      return errorResult(error)
    }
  })

  server.registerTool("affinity_list_documents", {
    description: "List the documents currently open in Affinity with their session UUIDs, titles, paths, and dirty state.",
    inputSchema: emptyInput,
    annotations: readOnly,
  }, () => runScript(gateway, listDocumentsScript(), documentListSchema))

  server.registerTool("affinity_new_document", {
    description: "Create a new Affinity document, either from a named preset (for example 'A4', 'IG Post', 'Icon') or from explicit width, height, and units. Optionally save it straight to save_as. Returns the document's session UUID for later tools.",
    inputSchema: newDocumentInput,
    annotations: additive,
  }, (args) => runScript(gateway, newDocumentScript(args), documentInfoSchema))

  server.registerTool("affinity_open_document", {
    description: "Open an existing document from an absolute path (or return it if it is already open). Affinity's filesystem setting limits which folders are readable; the Desktop is allowed by default.",
    inputSchema: pathInput,
    annotations: additive,
  }, (args) => runScript(gateway, openDocumentScript(args.path), documentInfoSchema))

  server.registerTool("affinity_get_document_settings", {
    description: "Read a document's setup: pixel dimensions, dpi, units, colour format and profile, layer and artboard counts, fonts, and dirty/undo state. Defaults to the current document; pass session_uuid to target a specific one.",
    inputSchema: sessionUuidInput,
    annotations: readOnly,
  }, (args) => runScript(gateway, getDocumentSettingsScript(args.session_uuid), documentSettingsSchema))

  server.registerTool("affinity_set_document_settings", {
    description: "Change a document's setup and return the updated settings. Supports units, dpi, pixel width/height, and transparent_background. Changing dpi, size, or transparency rewrites document setup; other settings are preserved, but background transparency resets to opaque unless transparent_background is given. Defaults to the current document; pass session_uuid to target a specific one.",
    inputSchema: setDocumentSettingsInput,
    annotations: destructive,
  }, (args: SetDocumentSettingsInput) => runScript(gateway, setDocumentSettingsScript(args), documentSettingsSchema))

  server.registerTool("affinity_export", {
    description: "Export a document to an absolute path as png, jpeg, tiff, pdf, svg, webp, or gif. area is whole_document (default), current_spread, current_page, or selection. Affinity's filesystem setting limits where files can be written; the Desktop is allowed by default. Defaults to the current document.",
    inputSchema: exportInput,
    annotations: additive,
  }, (args) => runScript(gateway, exportScript(args satisfies ExportInput), exportResultSchema))

  server.registerTool("affinity_add_shape", {
    description: "Add a rectangle or ellipse at pixel coordinates (x, y, width, height) with an optional #RRGGBB or #RRGGBBAA fill. Defaults to the current document; pass session_uuid to target another.",
    inputSchema: addShapeInput,
    annotations: additive,
  }, (args: AddShapeInput) => runScript(gateway, addShapeScript(args), addNodeResultSchema))

  server.registerTool("affinity_add_text", {
    description: "Add a text frame containing text at pixel coordinates (x, y, width, height), using the document's default text style. Defaults to the current document; pass session_uuid to target another.",
    inputSchema: addTextInput,
    annotations: additive,
  }, (args: AddTextInput) => runScript(gateway, addTextScript(args), addNodeResultSchema))

  server.registerTool("affinity_place_image", {
    description: "Place an image file into the document. Give x, y, width, height to fit it to a rectangle, or omit them for the image's natural size. Affinity's filesystem setting limits which folders are readable; the Desktop is allowed by default. Defaults to the current document.",
    inputSchema: placeImageInput,
    annotations: additive,
  }, (args: PlaceImageInput) => runScript(gateway, placeImageScript(args), addNodeResultSchema))

  server.registerTool("affinity_add_sdk_hint", {
    description: "Add a verified SDK hint to Affinity's preamble for future sessions.",
    inputSchema: hintInput,
    annotations: additive,
  }, (args) => dispatch(gateway, "add_sdk_hint", args))

  server.registerTool("affinity_execute_script", {
    description: "Execute JavaScript in Affinity. This can modify documents and access capabilities allowed by Affinity settings.",
    inputSchema: scriptInput,
    annotations: destructive,
  }, (args) => dispatch(gateway, "execute_script", args))

  server.registerTool("affinity_list_library_scripts", {
    description: "List scripts in Affinity's script library.",
    inputSchema: emptyInput,
    annotations: readOnly,
  }, (args) => dispatch(gateway, "list_library_scripts", args))

  server.registerTool("affinity_list_sdk_documentation", {
    description: "List available Affinity SDK documentation topics.",
    inputSchema: emptyInput,
    annotations: readOnly,
  }, (args) => dispatch(gateway, "list_sdk_documentation", args))

  server.registerTool("affinity_read_library_script", {
    description: "Read a named script from Affinity's script library.",
    inputSchema: titleInput,
    annotations: readOnly,
  }, (args) => dispatch(gateway, "read_library_script", args))

  server.registerTool("affinity_read_sdk_documentation_topic", {
    description: "Read an Affinity SDK documentation topic by filename.",
    inputSchema: documentationInput,
    annotations: readOnly,
  }, (args) => dispatch(gateway, "read_sdk_documentation_topic", args))

  server.registerTool("affinity_render_selection", {
    description: "Render the selected nodes in a document session as a JPEG.",
    inputSchema: documentInput,
    annotations: readOnly,
  }, (args) => dispatch(gateway, "render_selection", args))

  server.registerTool("affinity_render_spread", {
    description: "Render a zero-based spread in a document session as a JPEG.",
    inputSchema: spreadInput,
    annotations: readOnly,
  }, (args) => dispatch(gateway, "render_spread", args))

  server.registerTool("affinity_report_sdk_issue", {
    description: "Report a confirmed Affinity SDK issue with optional reproduction code.",
    inputSchema: issueInput,
    annotations: additive,
  }, (args) => dispatch(gateway, "report_sdk_issue", args))

  server.registerTool("affinity_save_script_to_library", {
    description: "Save a completed JavaScript script to Affinity's script library.",
    inputSchema: savedScriptInput,
    annotations: destructive,
  }, (args) => dispatch(gateway, "save_script_to_library", args))

  server.registerTool("affinity_search_sdk_hints", {
    description: "Search shared Affinity SDK hints for an existing solution.",
    inputSchema: searchInput,
    annotations: readOnly,
  }, (args) => dispatch(gateway, "search_sdk_hints", args))

  return server
}

export function createAffinityMcpHandler(deps: AffinityServerDependencies) {
  return createMcpHandler(() => createAffinityServer(deps), { legacy: "stateless" })
}

async function dispatch(
  gateway: AffinityGateway,
  name: AffinityToolName,
  args: Record<string, unknown>,
): Promise<AffinityToolResult> {
  try {
    return await gateway.callTool(name, args)
  } catch (error) {
    return errorResult(error)
  }
}

async function runScript<T extends Record<string, unknown>>(
  gateway: AffinityGateway,
  script: string,
  schema: z.ZodType<T>,
): Promise<AffinityToolResult> {
  let outcome: ScriptOutcome<T>

  try {
    outcome = decodeScriptResult(await gateway.callTool("execute_script", { script }), schema)
  } catch (error) {
    return errorResult(error)
  }

  if (!outcome.ok) {
    const details = { code: "AFFINITY_SCRIPT_ERROR", message: outcome.error }

    return { content: [{ type: "text", text: JSON.stringify(details) }], structuredContent: details, isError: true }
  }

  return { content: [{ type: "text", text: JSON.stringify(outcome.value) }], structuredContent: outcome.value, isError: false }
}

function statusResult(status: AffinityStatus): AffinityToolResult {
  return {
    content: [{ type: "text", text: JSON.stringify(status) }],
    structuredContent: status,
    isError: false,
  }
}

function errorResult(error: unknown): AffinityToolResult {
  const details = normalizeAffinityError(error)

  return {
    content: [{ type: "text", text: JSON.stringify(details) }],
    structuredContent: details,
    isError: true,
  }
}
