import * as z from "zod/v4"
import { DOCUMENT_REQUIRES, DOCUMENT_HELPERS } from "./documents.ts"
import { buildScript } from "./script-runtime.ts"

// Simple format names mapped to Affinity's built-in export presets.
const FORMAT_PRESETS = {
  png: "PNG",
  jpeg: "JPEG (High quality)",
  tiff: "TIFF RGB 8-bit",
  pdf: "PDF (for export)",
  svg: "SVG (for export)",
  webp: "WebP (High Quality)",
  gif: "GIF RGB",
} as const

export const EXPORT_FORMATS = Object.keys(FORMAT_PRESETS) as (keyof typeof FORMAT_PRESETS)[]

const EXPORT_AREAS = {
  whole_document: "createForWholeDocument()",
  current_spread: "createForCurrentSpread()",
  current_page: "createForCurrentPage()",
  selection: "createForSelection(doc.selection)",
} as const

export const EXPORT_AREAS_LIST = Object.keys(EXPORT_AREAS) as (keyof typeof EXPORT_AREAS)[]

export type ExportInput = {
  path: string
  format: keyof typeof FORMAT_PRESETS
  area?: keyof typeof EXPORT_AREAS
  session_uuid?: string
}

export const exportResultSchema = z.object({
  ok: z.boolean(),
  records: z.array(z.object({
    path: z.string(),
    ok: z.boolean(),
    warning: z.string(),
    error: z.string(),
  })),
})

const EXPORT_REQUIRES = `${DOCUMENT_REQUIRES}
const { FileExportOptions, FileExportArea } = require('/document.js');${DOCUMENT_HELPERS}`

export function exportScript(input: ExportInput): string {
  const preset = FORMAT_PRESETS[input.format]
  const area = EXPORT_AREAS[input.area ?? "whole_document"]

  return buildScript(EXPORT_REQUIRES, `  const doc = resolveDoc(${JSON.stringify(input.session_uuid ?? null)});
  const options = FileExportOptions.createWithPresetName(${JSON.stringify(preset)});
  const area = FileExportArea.${area};
  const records = doc.export(${JSON.stringify(input.path)}, options, area).all.map((r) => ({
    path: r.path,
    ok: r.isSuccess,
    warning: r.hasWarnings ? r.warningMessage : "",
    error: r.errorMessage,
  }));
  finish({ ok: records.length > 0 && records.every((r) => r.ok), records });`)
}
