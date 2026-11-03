import { build } from "esbuild"

await Promise.all([
  build({
    entryPoints: ["src/index.ts"],
    outfile: "dist/index.js",
    bundle: true,
    packages: "external",
    platform: "node",
    format: "esm",
    target: "node22",
  }),
  build({
    entryPoints: ["test/*.test.ts"],
    outdir: "dist-tests",
    bundle: true,
    platform: "node",
    format: "esm",
    target: "node22",
  }),
])
