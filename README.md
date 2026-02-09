# opentui-nvim

To install dependencies:

```bash
bun install
```

To run:

```bash
bun run index.ts
```

Logging:

- Logs are written to `logs/app.log`.
- The file is overwritten on each app start.
- Optional env vars:
  - `LOG_FILE` to change the log file path.
  - `LOG_LEVEL` to change the minimum log level (default: `debug`).

This project was created using `bun init` in bun v1.3.6. [Bun](https://bun.com) is a fast all-in-one JavaScript runtime.
