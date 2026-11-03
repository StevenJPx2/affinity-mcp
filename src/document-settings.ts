import * as z from "zod/v4"
import { DOCUMENT_REQUIRES, DOCUMENT_HELPERS, DOCUMENT_UNITS } from "./documents.ts"
import { buildScript } from "./script-runtime.ts"

export const documentSettingsSchema = z.object({
  session_uuid: z.string(),
  title: z.string(),
  path: z.string(),
  width_pixels: z.number(),
  height_pixels: z.number(),
  dpi: z.number(),
  units: z.string(),
  colour_format: z.string(),
  colour_profile: z.string().nullable(),
  mask_format: z.string(),
  layer_count: z.number(),
  artboard_count: z.number(),
  has_artboards: z.boolean(),
  fonts: z.array(z.string()),
  is_dirty: z.boolean(),
  can_undo: z.boolean(),
  can_redo: z.boolean(),
})

export type DocumentSettings = z.infer<typeof documentSettingsSchema>

export type SetDocumentSettingsInput = {
  session_uuid?: string
  units?: (typeof DOCUMENT_UNITS)[number]
  dpi?: number
  width_pixels?: number
  height_pixels?: number
  transparent_background?: boolean
}

const SETTINGS_REQUIRES = `${DOCUMENT_REQUIRES}
const { DocumentProperties } = require('/documentproperties.js');${DOCUMENT_HELPERS}
function readSettings(doc) {
  const size = doc.sizePixels;
  return {
    session_uuid: doc.sessionUuid,
    title: doc.title,
    path: doc.path,
    width_pixels: size.width,
    height_pixels: size.height,
    dpi: doc.dpi,
    units: String(doc.units),
    colour_format: String(doc.format),
    colour_profile: doc.colourProfile ? doc.colourProfile.name : null,
    mask_format: String(doc.maskFormat),
    layer_count: doc.layers.length,
    artboard_count: doc.hasArtboards ? doc.artboards.length : 0,
    has_artboards: doc.hasArtboards,
    fonts: doc.getFontNames(),
    is_dirty: doc.isDirty,
    can_undo: doc.canUndo,
    can_redo: doc.canRedo,
  };
}`

export function getDocumentSettingsScript(sessionUuid?: string): string {
  return buildScript(SETTINGS_REQUIRES, `  const doc = resolveDoc(${JSON.stringify(sessionUuid ?? null)});
  finish(readSettings(doc));`)
}

export function setDocumentSettingsScript(input: SetDocumentSettingsInput): string {
  const needsProperties =
    input.dpi !== undefined ||
    input.width_pixels !== undefined ||
    input.height_pixels !== undefined ||
    input.transparent_background !== undefined
  const changeUnits = input.units === undefined
    ? ""
    : `  doc.units = UnitType[${JSON.stringify(input.units)}];`
  const transparency = input.transparent_background === undefined
    ? ""
    : `    props.isTransparent = ${input.transparent_background};`

  // A dpi, size, or transparency change rewrites document setup, so seed the properties from the
  // current document and override only the requested fields.
  const applyProperties = needsProperties
    ? `  {
    const size = doc.sizePixels;
    const props = DocumentProperties.create();
    props.dimensions = {
      width: ${input.width_pixels ?? "size.width"},
      height: ${input.height_pixels ?? "size.height"},
    };
    props.dpi = ${input.dpi ?? "doc.dpi"};
    props.units = doc.units;
    props.setColourFormatAndProfile(doc.format, doc.colourProfile);
${transparency}
    doc.setDocumentProperties(props);
  }`
    : ""

  return buildScript(SETTINGS_REQUIRES, `  const doc = resolveDoc(${JSON.stringify(input.session_uuid ?? null)});
${changeUnits}
${applyProperties}
  finish(readSettings(doc));`)
}
