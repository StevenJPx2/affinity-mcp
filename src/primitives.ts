import * as z from "zod/v4"
import { DOCUMENT_REQUIRES, DOCUMENT_HELPERS } from "./documents.ts"
import { buildScript } from "./script-runtime.ts"

export const SHAPE_KINDS = ["rectangle", "ellipse"] as const

const rectFields = {
  x: z.number(),
  y: z.number(),
  width: z.number().positive(),
  height: z.number().positive(),
}
const hexColour = z.string().regex(/^#(?:[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/, "Use #RRGGBB or #RRGGBBAA")

export const addShapeInput = z.object({
  session_uuid: z.string().uuid().optional(),
  kind: z.enum(SHAPE_KINDS),
  ...rectFields,
  fill: hexColour.optional(),
}).strict()

export const addTextInput = z.object({
  session_uuid: z.string().uuid().optional(),
  text: z.string().min(1),
  ...rectFields,
}).strict()

export const placeImageInput = z.object({
  session_uuid: z.string().uuid().optional(),
  image_path: z.string().min(1),
  x: z.number().optional(),
  y: z.number().optional(),
  width: z.number().positive().optional(),
  height: z.number().positive().optional(),
}).strict().refine(
  (value) => {
    const rect = [value.x, value.y, value.width, value.height]
    const set = rect.filter((field) => field !== undefined).length

    return set === 0 || set === 4
  },
  { message: "Provide all of x, y, width, height to place at a rectangle, or none to use the image's natural size" },
)

export type AddShapeInput = z.infer<typeof addShapeInput>
export type AddTextInput = z.infer<typeof addTextInput>
export type PlaceImageInput = z.infer<typeof placeImageInput>

export const addNodeResultSchema = z.object({
  session_uuid: z.string(),
  layer_count: z.number(),
})

const PRIMITIVE_REQUIRES = `${DOCUMENT_REQUIRES}
const { Rectangle, Transform } = require('/geometry.js');
const { ShapeNodeDefinition, FrameTextNodeDefinition, ImageNodeDefinition } = require('/nodes.js');
const { ShapeRectangle, ShapeEllipse } = require('/shapes.js');
const { StoryBuilder } = require('/storybuilder.js');
const { Colour } = require('/colours.js');
const { Bitmap } = require('/rasterobject.js');${DOCUMENT_HELPERS}`

// Emits the JS expression that builds a Colour from a validated hex string, or "null".
function colourExpr(hex: string | undefined): string {
  if (hex === undefined) return "null"

  const value = hex.slice(1)
  const channels = value.length === 6 ? [...chunk(value), "ff"] : chunk(value)
  const floats = channels.map((pair) => (Number.parseInt(pair, 16) / 255).toFixed(6))

  return `Colour.createRGBAuf([${floats.join(", ")}])`
}

function chunk(value: string): string[] {
  const pairs: string[] = []
  for (let index = 0; index < value.length; index += 2) pairs.push(value.slice(index, index + 2))

  return pairs
}

export function addShapeScript(input: AddShapeInput): string {
  const shape = input.kind === "rectangle" ? "ShapeRectangle.create()" : "ShapeEllipse.create()"
  const fill = colourExpr(input.fill)

  return buildScript(PRIMITIVE_REQUIRES, `  const doc = resolveDoc(${JSON.stringify(input.session_uuid ?? null)});
  const def = ShapeNodeDefinition.createDefault();
  def.shape = ${shape};
  def.setBoundingRectangle(new Rectangle(${input.x}, ${input.y}, ${input.width}, ${input.height}));
  const fill = ${fill};
  if (fill) def.addBrushFillDescriptor(fill);
  doc.addNode(def);
  finish({ session_uuid: doc.sessionUuid, layer_count: doc.layers.length });`)
}

export function addTextScript(input: AddTextInput): string {
  return buildScript(PRIMITIVE_REQUIRES, `  const doc = resolveDoc(${JSON.stringify(input.session_uuid ?? null)});
  const sb = StoryBuilder.create();
  sb.setToFrameTextDefaultStyle(doc.dpi, doc.format);
  sb.addText(${JSON.stringify(input.text)});
  const def = FrameTextNodeDefinition.createFromStoryBuilder(new Rectangle(${input.x}, ${input.y}, ${input.width}, ${input.height}), sb);
  doc.addNode(def);
  finish({ session_uuid: doc.sessionUuid, layer_count: doc.layers.length });`)
}

export function placeImageScript(input: PlaceImageInput): string {
  const hasRect =
    input.x !== undefined && input.y !== undefined && input.width !== undefined && input.height !== undefined
  const transform = hasRect
    ? `  const xf = Transform.createTranslate(${input.x}, ${input.y}).multiply(Transform.createScale(${input.width} / bm.width, ${input.height} / bm.height));
  def.setTransform(xf);`
    : ""

  return buildScript(PRIMITIVE_REQUIRES, `  const doc = resolveDoc(${JSON.stringify(input.session_uuid ?? null)});
  const bm = Bitmap.loadFromFile(${JSON.stringify(input.image_path)});
  const def = ImageNodeDefinition.create(doc.format);
  def.setBitmap(bm);
${transform}
  doc.addNode(def);
  finish({ session_uuid: doc.sessionUuid, layer_count: doc.layers.length });`)
}
