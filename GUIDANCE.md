# Agent Guidance

- The adapter reads the required `preamble` immediately after connecting. Do not repeat that read solely to satisfy the prerequisite.
- Read relevant SDK documentation before using unfamiliar SDK calls.
- Search SDK hints before experimenting. Add a hint after experimentation discovers a verified solution.
- Use `affinity_render_spread` or `affinity_render_selection` to verify visual results.
- Never assume an active document from its title when duplicate titles may exist. Use the document session UUID returned by Affinity.
- Use `affinity_list_documents`, `affinity_new_document`, and `affinity_open_document` to find or create the document to work on; they return the session UUID that render and script tools need. Opening an already-open file returns the existing document rather than a duplicate, and does not make it current.
- Use `affinity_get_document_settings` / `affinity_set_document_settings` for document setup (dimensions, dpi, units, transparency). Both default to the current document; pass `session_uuid` for a specific one. The SDK has no read path for background transparency, so a dpi or size change resets it to opaque unless you pass `transparent_background`.
- Use `affinity_add_shape`, `affinity_add_text`, `affinity_place_image` to build content, and `affinity_export` to write output. Coordinates are pixels from the top-left. `affinity_add_text` uses the document's default text style; for coloured or styled text, use `affinity_execute_script` with the StoryBuilder glyph-attribute API.
- Affinity reports uncaught script exceptions as ordinary text with `isError: false`. In `affinity_execute_script`, wrap work in try/catch and log a clear success or failure line.
- Every Affinity tool launches Affinity automatically if it is not running (expect ~10s on the first call). `AFFINITY_UNAVAILABLE` means launching failed; report the reason to the user instead of retrying in a loop or using `osascript`/shell `open` yourself.
- The adapter reconnects and re-reads the preamble automatically after Affinity restarts. Hints and library scripts persist across sessions; in-memory document state does not.
- Keep scripts directly executable and use `console.log()` for output.
