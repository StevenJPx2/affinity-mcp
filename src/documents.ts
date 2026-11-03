import * as z from "zod/v4"
import { buildScript } from "./script-runtime.ts"

export const DOCUMENT_UNITS = ["Pixel", "Point", "Millimetre", "Centimetre", "Inch"] as const

export const documentInfoSchema = z.object({
  session_uuid: z.string(),
  title: z.string(),
  path: z.string(),
  is_dirty: z.boolean(),
  is_current: z.boolean(),
})

export type DocumentInfo = z.infer<typeof documentInfoSchema>

export type NewDocumentInput =
  | { preset: string; save_as?: string }
  | { width: number; height: number; units: (typeof DOCUMENT_UNITS)[number]; dpi?: number; save_as?: string }

// JS injected into scripts that need to describe or locate a document. Shared with document-settings.
export const DOCUMENT_REQUIRES = `const { Document, DocumentPreset, NewDocumentOptions, UnitType } = require('/document.js');`
export const DOCUMENT_HELPERS = `
function describe(doc) {
  const current = Document.current;
  return {
    session_uuid: doc.sessionUuid,
    title: doc.title,
    path: doc.path,
    is_dirty: doc.isDirty,
    is_current: current != null && doc.isSameObject(current),
  };
}
function resolveDoc(sessionUuid) {
  if (sessionUuid) {
    const found = Document.all.find((d) => d.sessionUuid === sessionUuid);
    if (!found) throw new Error('No open document with session_uuid ' + sessionUuid);
    return found;
  }
  const current = Document.current;
  if (!current) throw new Error('No current document; pass session_uuid or open a document first');
  return current;
}
`

export function listDocumentsScript(): string {
  return buildScript(`${DOCUMENT_REQUIRES}${DOCUMENT_HELPERS}`, `  finish({ documents: Document.all.map(describe) });`)
}

export function newDocumentScript(input: NewDocumentInput): string {
  const create = "preset" in input
    ? `  const preset = DocumentPreset.all.find((p) => p.name === ${JSON.stringify(input.preset)});
  if (!preset) throw new Error('Unknown preset ' + ${JSON.stringify(input.preset)} + '. Available: ' + [...new Set(DocumentPreset.all.map((p) => p.name))].join(', '));
  const doc = Document.createFromPreset(preset);`
    : `  const options = NewDocumentOptions.createDefault();
  options.units = UnitType[${JSON.stringify(input.units)}];
  options.width = ${input.width};
  options.height = ${input.height};
  ${input.dpi === undefined ? "" : `options.dpi = ${input.dpi};`}
  const doc = Document.create(options);`
  const save = input.save_as === undefined ? "" : `  doc.saveAs(${JSON.stringify(input.save_as)});`

  return buildScript(`${DOCUMENT_REQUIRES}${DOCUMENT_HELPERS}`, `${create}
${save}
  finish(describe(doc));`)
}

export function openDocumentScript(path: string): string {
  return buildScript(`${DOCUMENT_REQUIRES}${DOCUMENT_HELPERS}`, `  const path = ${JSON.stringify(path)};
  const doc = Document.all.find((d) => d.path === path) ?? Document.load(path);
  finish(describe(doc));`)
}
