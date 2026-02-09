import { createCliRenderer, TextRenderable } from "@opentui/core";
import { NvimRenderable } from "./src/NvimRenderable";

const renderer = await createCliRenderer({
  useMouse: false,
  useAlternateScreen: true,
});

renderer.root.add(
  new TextRenderable(renderer, {
    id: "banner",
    content: "OpenTUI Neovim demo (Ctrl+C to exit)",
    width: "100%",
    height: 1,
  }),
);

const nvim = new NvimRenderable(renderer, {
  logRpc: true,
});

renderer.root.add(nvim);
nvim.focus();
