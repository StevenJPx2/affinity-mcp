# affinity-mcp

`affinity-mcp` is a small stdio MCP adapter for Affinity 3's local legacy SSE MCP connector. It exposes the connector's tools with stable `affinity_` names and manages the upstream session for you: it connects on first use, reads the required SDK `preamble`, and reconnects (re-reading the preamble) if Affinity quits.

```text
MCP host <-> stdio <-> affinity-mcp <-> legacy SSE <-> Affinity 3
```

The adapter always starts, whether or not Affinity is running. Any Affinity tool call opens Affinity if needed: it first tries to reconnect (in case Affinity is running but the session dropped), and only then launches it with macOS `open -g -b com.canva.affinity` in the background without stealing focus, waiting for the connector at `http://localhost:6767/sse`. If Affinity still cannot be reached, the tool returns `AFFINITY_UNAVAILABLE` with the reason. Nothing else activates, focuses, or scripts the application.

## Install

Requires Node.js 22 or newer.

```sh
npm install
npm run check
npm link
```

## Configuration

- `AFFINITY_MCP_URL`: Affinity SSE endpoint. Default: `http://localhost:6767/sse`.
- `AFFINITY_SCRIPT_TIMEOUT_MS`: upstream call timeout in milliseconds. Default: `300000`.
- `AFFINITY_BUNDLE_ID`: macOS bundle identifier `affinity_open` launches. Default: `com.canva.affinity`.
- `AFFINITY_LAUNCH_TIMEOUT_MS`: how long `affinity_open` waits for the connector after launching. Default: `120000`.

Generic stdio MCP configuration for OpenCode, Claude Desktop, or another MCP host:

```json
{
  "mcpServers": {
    "affinity": {
      "command": "affinity-mcp",
      "env": {
        "AFFINITY_MCP_URL": "http://localhost:6767/sse",
        "AFFINITY_SCRIPT_TIMEOUT_MS": "300000"
      }
    }
  }
}
```

Without `npm link`, use the absolute built executable:

```json
{
  "mcpServers": {
    "affinity": {
      "command": "node",
      "args": ["/absolute/path/to/affinity-mcp/dist/index.js"]
    }
  }
}
```

## Tools

Adapter lifecycle:

- `affinity_status`: connection state (`disconnected` with a reason, `connecting`, or `connected`). Never launches Affinity.
- `affinity_open`: launches Affinity if needed, waits for the connector, and connects. Every other tool does this implicitly; use it to warm Affinity up ahead of a long session.

Document management (implemented as SDK scripts over the connector's `execute_script`; each opens Affinity first if needed):

- `affinity_list_documents`: open documents with `session_uuid`, `title`, `path`, `is_dirty`, `is_current`.
- `affinity_new_document`: create from a preset name (`{ "preset": "A4" }`) or explicit size (`{ "width": 1080, "height": 1080, "units": "Pixel", "dpi": 72 }`), optionally saving to `save_as`. An unknown preset fails with the list of available names.
- `affinity_open_document`: open a file by absolute path, or return it if already open. Paths outside Affinity's permitted folders (Desktop by default) fail with `PERMISSION_DENIED`.
- `affinity_get_document_settings`: read pixel dimensions, dpi, units, colour format and profile, mask format, layer and artboard counts, fonts, and dirty/undo state. Defaults to the current document; pass `session_uuid` to target another.
- `affinity_set_document_settings`: change `units`, `dpi`, `width_pixels`/`height_pixels`, and `transparent_background`, returning the updated settings. Units use a dedicated command; dpi, size, and transparency rewrite document setup (other settings are preserved, but background transparency resets to opaque unless `transparent_background` is given).

Content and output (also SDK scripts over `execute_script`; each opens Affinity first if needed):

- `affinity_export`: export to an absolute `path` as `png`, `jpeg`, `tiff`, `pdf`, `svg`, `webp`, or `gif`. `area` is `whole_document` (default), `current_spread`, `current_page`, or `selection`. Writing outside Affinity's permitted folders (Desktop by default) fails with `PERMISSION_DENIED`.
- `affinity_add_shape`: add a `rectangle` or `ellipse` at pixel `x`, `y`, `width`, `height` with an optional `#RRGGBB`/`#RRGGBBAA` `fill`.
- `affinity_add_text`: add a text frame with `text` at pixel `x`, `y`, `width`, `height`, using the document's default text style.
- `affinity_place_image`: place an image file; give `x`, `y`, `width`, `height` to fit a rectangle or omit them for natural size. Reading outside permitted folders fails with `PERMISSION_DENIED`.

Content tools return the target `session_uuid` and the document's new `layer_count`. Script failures from all script-backed tools are reported as `AFFINITY_SCRIPT_ERROR`.

Affinity connector tools (unchanged upstream semantics; each opens Affinity first if it is not running):

- `affinity_add_sdk_hint`
- `affinity_execute_script`
- `affinity_list_library_scripts`
- `affinity_list_sdk_documentation`
- `affinity_read_library_script`
- `affinity_read_sdk_documentation_topic`
- `affinity_render_selection`
- `affinity_render_spread`
- `affinity_report_sdk_issue`
- `affinity_save_script_to_library`
- `affinity_search_sdk_hints`

## Security

`affinity_execute_script` runs JavaScript inside Affinity and can modify open documents. Depending on Affinity's settings, scripts may also use AI, networking, or limited filesystem capabilities. Review generated scripts and keep Affinity's permissions restricted to what the task requires.

The only process the adapter starts is `open -g -b <bundle id>`, run only when Affinity is not reachable and only on macOS. It never uses `osascript` or asks Affinity to become the active application.

## Architecture

- `src/affinity-client.ts` owns the lazy upstream SSE session: connect on demand, preamble read per session, timeout, dropping the session when the event stream errors or a send fails, and error normalization.
- `src/affinity-launcher.ts` launches Affinity and waits (bounded) for the connector.
- `src/script-runtime.ts` builds each generated script (a marker-line success/failure protocol, since Affinity reports uncaught script exceptions as plain text with `isError: false`) and decodes the result.
- `src/documents.ts`, `src/document-settings.ts`, `src/export.ts`, and `src/primitives.ts` build the document, setup, export, and content scripts on that runtime and define their result schemas.
- `src/server.ts` defines the typed stdio-facing tools and delegates calls without changing upstream text, image content, or `isError`.
- `src/index.ts` serves stdio immediately, attempts an opportunistic upstream connection, and closes both sides during shutdown. Diagnostics use stderr only.
