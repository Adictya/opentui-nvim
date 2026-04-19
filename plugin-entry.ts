import type {
  TuiHostSlotMap,
  TuiPlugin,
  TuiPluginModule,
  TuiPromptInfo,
  TuiPromptRef,
  TuiSlotContext,
} from "@opencode-ai/plugin/tui";
import { DefaultHomePromptMirror } from "./default-prompt.tsx";
// import { NvimRenderable } from "./index.ts";
import { NvimEditorRenderable as NvimRenderable } from "./src/NvimEditorRenderable.ts";

const tui: TuiPlugin = async (api) => {
  api.slots.register({
    slots: {
      home_prompt(
        _ctx: TuiSlotContext,
        slotProps: TuiHostSlotMap["home_prompt"],
      ) {
        let currentPrompt: TuiPromptInfo = {
          input: "",
          mode: "normal",
          parts: [],
        };

        const editor = new NvimRenderable(api.renderer, {
          border: false,
          cursorColor: api.theme.current.primary,
          height: 6,
          onChange(event) {
            currentPrompt = {
              ...currentPrompt,
              input: event.value,
            };
          },
          selectionBg: api.theme.current.backgroundElement,
          backgroundColor: api.theme.current.backgroundElement,
          selectionFg: api.theme.current.text,
          tabSize: 2,
          textColor: api.theme.current.text,
          wrapMode: "word",
        });

        const ref: TuiPromptRef = {
          get focused() {
            return editor.focused;
          },
          get current() {
            return currentPrompt;
          },
          set(prompt) {
            currentPrompt = prompt;
            void editor.setValue(prompt.input);
          },
          reset() {
            currentPrompt = {
              input: "",
              mode: "normal",
              parts: [],
            };
            void editor.setValue("");
          },
          blur() {
            editor.blur();
          },
          focus() {
            editor.focus();
          },
          submit() {},
        };

        slotProps.ref?.(ref);

        queueMicrotask(() => editor.focus());

        return DefaultHomePromptMirror({
          agentsKeyHint: api.keybind.print("agent_cycle"),
          modelName: "GPT-5.4",
          providerName: "OpenAI",
          agentName: "Build",
          variant: "xhigh",
          api,
          commandsKeyHint: api.keybind.print("command_list"),
          input: editor,
          slotProps,
        });
      },
    },
  });
};

export default {
  id: "nvim-prompt-replace",
  tui,
} satisfies TuiPluginModule & { id: string };
