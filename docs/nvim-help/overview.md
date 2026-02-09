# Neovim Headless + Embedded UI Protocol (Neovim v0.11.5)

This project talks to Neovim as an *external UI* over Msgpack-RPC.

Primary references (local `:help` dumps):

- `docs/nvim-help/starting.txt` (`*--embed*`, `*--headless*`, `*--listen*`)
- `docs/nvim-help/ui.txt` (`*ui*`, `*ui-events*`, `*ui-linegrid*`, `*ui-startup*`)
- `docs/nvim-help/api.txt` (`*msgpack-rpc*`, `*api-metadata*`, `*api-ui*`, `*nvim_ui_attach()*`)
- `docs/nvim-help/channel.txt` (`*channel-stdio*`, `*channel-intro*`)

## 1) How to start Neovim (spawn + transport)

Neovim supports a few "headless" shapes, but for a custom UI you mostly care about:

- **Spawn + stdio RPC (embedder)**: start Nvim with `--embed` and speak Msgpack-RPC on stdin/stdout.
  - Per `docs/nvim-help/starting.txt` (`*--embed*`), Nvim **waits for `nvim_ui_attach()`** before it continues startup, so the UI can attach early and see early messages.
  - Typical for a UI process that owns the Nvim process.

- **Headless scripting / non-UI embedder**: add `--headless`.
  - Per `docs/nvim-help/starting.txt` (`*--headless*`), Nvim starts without a UI and does **not** wait for `nvim_ui_attach`.
  - This is great for tests/automation; it's *not* the "best" default for a UI embedder if you care about deterministic early startup.

- **Attach to an existing Nvim**: start Nvim with `--listen {addr}` (or use its default `v:servername`) and connect a client.
  - See `docs/nvim-help/starting.txt` (`*--listen*`) and `docs/nvim-help/api.txt` (`*rpc-connecting*`).

## 2) Msgpack-RPC basics (what you implement)

Neovim implements MessagePack-RPC (see `docs/nvim-help/api.txt` `*msgpack-rpc*`). In practice your client must:

- **Encode/decode MessagePack** on a byte stream.
- **Support the 3 message kinds** (MessagePack-RPC spec):
  - Request: `[0, msgid, method, params]`
  - Response: `[1, msgid, error, result]`
  - Notification: `[2, method, params]`

Neovim-specific RPC notes from `docs/nvim-help/api.txt` (`*msgpack-rpc*`):

- Responses are returned in *reverse order of requests* (stack-like).
- Nvim processes all messages in the order received.

Also: be prepared to **receive requests from Nvim** (rare, but possible). If you ignore requests and never reply, you can stall its RPC loop.

## 3) UI attach handshake (the "remote UI protocol" entry point)

All remote UIs start by calling `nvim_ui_attach(width, height, options)`.

- UI options and redraw model are described in `docs/nvim-help/ui.txt` (`*ui-option*`, `*ui-events*`).
- The API function is documented in `docs/nvim-help/api.txt` (`*nvim_ui_attach()*`).

Key points:

- Unknown UI options are an error (`docs/nvim-help/ui.txt`). Use `nvim_get_api_info()` and inspect `ui_options` / `ui_events` in `api-metadata` (`docs/nvim-help/api.txt` `*api-metadata*`).
- If multiple UIs are attached, the effective screen size becomes the smallest attached UI (`docs/nvim-help/api.txt` `*nvim_ui_attach()*`).
- For new UIs, `ext_linegrid` is recommended (`docs/nvim-help/ui.txt` `*ui-linegrid*`).

## 4) Rendering model: `redraw` batches and `flush`

After `nvim_ui_attach`, Nvim sends Msgpack-RPC **notifications** with method name `"redraw"`.

From `docs/nvim-help/ui.txt`:

- Each `redraw` notification contains a **batch** (array) of "update events".
- Events must be processed **in-order**.
- A `flush` event indicates a consistent screen state. The UI should present the final state only after `flush`.

For an `ext_linegrid` UI, the core events you usually implement first (all described under `*ui-linegrid*` in `docs/nvim-help/ui.txt`):

- `grid_resize`
- `grid_clear`
- `grid_line`
- `grid_scroll`
- `grid_cursor_goto`
- `flush`
- Highlight/color setup: `default_colors_set`, `hl_attr_define`

Important details that affect correctness:

- `grid_line` cells are `[text(, hl_id, repeat)]` (`docs/nvim-help/ui.txt` `*ui-event-grid_line*`).
- Double-width characters: the *right* cell is represented by an empty string (`""`) (`docs/nvim-help/ui.txt`).
- `grid_scroll` is "copy screen cells" semantics; scrolled-in area is filled by subsequent `grid_line` updates (`docs/nvim-help/ui.txt`).

## 5) Input, paste, mouse

Your UI sends user input back to Nvim via API calls:

- `nvim_input(keys)` queues raw input (`docs/nvim-help/api.txt` `*nvim_input()*`).
  - Keycodes like `<CR>` are translated; literal `<` must be sent as `<LT>`.

- `nvim_paste(data, crlf, phase)` is the preferred way to send large/pasted text (`docs/nvim-help/api.txt` `*nvim_paste()*`).

- Mouse: use `nvim_input_mouse(...)` (`docs/nvim-help/api.txt` `*nvim_input_mouse()*`).

## 6) Resizing

When your UI size changes:

- Call `nvim_ui_try_resize(width, height)` (`docs/nvim-help/api.txt` `*nvim_ui_try_resize()*`).
- If using multigrid, you may also need `nvim_ui_try_resize_grid(grid, ...)` (`docs/nvim-help/api.txt` `*nvim_ui_try_resize_grid()*`).

## 7) Practical "custom UI" checklist

If you're building a custom renderer (terminal, canvas, OpenTUI, etc.), this is the usual minimal stack:

1. Spawn `nvim --embed` (optionally `--clean`).
2. Start Msgpack encode/decode loops.
3. Optionally call `nvim_get_api_info()` to detect supported `ui_options`.
4. Call `nvim_ui_attach(cols, rows, { ext_linegrid: true, rgb: true, ... })`.
5. Consume `redraw` notifications, apply events to your own grid state, and only present after `flush`.
6. Forward input with `nvim_input` / `nvim_paste` (and mouse if needed).
7. On layout changes, call `nvim_ui_try_resize`.
8. On shutdown, `nvim_ui_detach()` (optional) and/or quit Neovim (`:qa!`).

## 8) Where this repo maps onto the protocol

- `src/nvim/NvimRpcClient.ts` implements Msgpack-RPC framing (requests/responses/notifications) and spawns Nvim with `--headless --embed`.
- `src/NvimRenderable.ts` calls `nvim_ui_attach` with `ext_linegrid` and handles core `redraw` events (`grid_line`, `grid_scroll`, `hl_attr_define`, `default_colors_set`, `flush`, ...) to maintain an internal grid.
