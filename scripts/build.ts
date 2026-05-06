import solidPlugin from "@opentui/solid/bun-plugin";

await Bun.build({
  entrypoints: ["./plugin-entry.tsx"],
  external: ["@opentui/core", "@opentui/solid", "@opencode-ai/plugin/tui"],
  plugins: [solidPlugin],
  target: "bun",
  outdir: "dist",
});
