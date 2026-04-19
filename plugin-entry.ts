import type { TuiPlugin, TuiPluginModule } from "@opencode-ai/plugin/tui";
import { NvimRenderable } from "./index.ts";
import { BoxRenderable } from "@opentui/core";

const tui: TuiPlugin = async (api) => {
  api.slots.register({
    slots: {
      home_logo(_ctx, _value) {
        api.renderer.console.show();
        let editor;
        editor = new NvimRenderable(api.renderer, {
          border: false,
          cursorColor: api.theme.current.primary,
          height: 30,
          selectionBg: api.theme.current.backgroundElement,
          selectionFg: api.theme.current.text,
          tabSize: 2,
          textColor: api.theme.current.text,
          title: "Ask from my plugin",
          wrapMode: "word",
        });

        // editor = new BoxRenderable(api.renderer, {
        //   border: true,
        //   title: "Ask from my plugin",
        // });

        // queueMicrotask(() => editor.focus());

        return editor;
      },
    },
  });
};

export default {
  id: "nvim-prompt-replace",
  tui,
} satisfies TuiPluginModule & { id: string };
