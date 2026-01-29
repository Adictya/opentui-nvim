# Neovim Help Dumps

This directory contains plain-text dumps of relevant Neovim `:help` topics for
the headless + embedded (Msgpack-RPC) protocol and the remote UI redraw model.

Generated on Thu Jan 29 2026 from:

- Neovim v0.11.5
- Commands like: `nvim --clean --headless "+help <topic> | w! <file> | qa"`

Files:

- `docs/nvim-help/overview.md` - practical notes for building a custom UI
- `docs/nvim-help/starting.txt` - CLI flags (`--embed`, `--headless`, `--listen`, ...)
- `docs/nvim-help/ui.txt` - UI protocol, `redraw` batches, `ext_linegrid` events
- `docs/nvim-help/api.txt` - RPC + API reference (includes `*msgpack-rpc*`)
- `docs/nvim-help/channel.txt` - channel transports (stdio, sockets, ...)

If you need to refresh these dumps after upgrading Neovim, re-run the generator
commands in your shell.
