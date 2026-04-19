import type { RenderContext } from "@opentui/core";
import { NvimRenderable, type NvimRenderableOptions } from "./NvimRenderable";

export class NvimEditorRenderable extends NvimRenderable {
  constructor(ctx: RenderContext, options: NvimRenderableOptions | undefined) {
    super(ctx, options);
  }
}
