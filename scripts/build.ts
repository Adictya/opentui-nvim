import solidPlugin from "@opentui/solid/bun-plugin"

Bun.build({
  entrypoints: ["./plugin-entry.ts"],
  external: ["@opentui/core", "@opentui/solid", "@opencode/plugin"],
	plugins: [solidPlugin],
  target: "bun",
  outdir: "dist",
});
