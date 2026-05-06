/** @jsxImportSource @opentui/solid */

import type {
  TuiHostSlotMap,
  TuiPlugin,
  TuiPluginModule,
  TuiPromptInfo,
  TuiPromptRef,
  TuiSlotContext,
} from "@opencode-ai/plugin/tui";
import { createSignal, onCleanup } from "solid-js";
import {
  DefaultHomePromptMirror,
  DefaultHomePromptRight,
  defaultHomePromptPlaceholders,
  getDefaultHomePromptPlaceholder,
} from "./default-prompt.tsx";
import { NvimEditorRenderable as NvimRenderable } from "./src/NvimEditorRenderable.ts";

type PluginApi = Parameters<TuiPlugin>[0];

function formatModeLabel(mode: string) {
  if (mode === "n") return "NORMAL";
  if (mode === "i" || mode === "ic" || mode === "ix") return "INSERT";
  if (mode === "v" || mode === "V" || mode === "\u0016") return "VISUAL";
  if (mode === "R" || mode === "Rc" || mode === "Rx") return "REPLACE";
  if (mode === "c" || mode === "cv" || mode === "ce") return "COMMAND";
  if (mode === "s" || mode === "S" || mode === "\u0013") return "SELECT";
  if (mode === "o") return "OPERATOR";
  if (mode.startsWith("cmdline")) return "COMMAND";
  if (mode === "normal") return "NORMAL";
  if (mode === "insert") return "INSERT";
  if (mode === "visual" || mode === "visual_select") return "VISUAL";
  if (mode === "replace") return "REPLACE";
  if (mode === "operator") return "OPERATOR";
  return mode.replace(/_/g, " ").toUpperCase();
}

function HomePrompt(props: {
  api: PluginApi;
  slotProps: TuiHostSlotMap["home_prompt"];
}) {
  const api = props.api;
  const slotProps = props.slotProps;
  let currentPrompt: TuiPromptInfo = {
    input: "",
    mode: "normal",
    parts: [],
  };
  const placeholderIndex = Math.floor(
    Math.random() * defaultHomePromptPlaceholders.normal.length,
  );
  const placeholder = getDefaultHomePromptPlaceholder(
    "normal",
    placeholderIndex,
  );
  const placeholderColor = api.theme.current.textMuted;
  const [modeLabel, setModeLabel] = createSignal("NORMAL");

  const editor = new NvimRenderable(api.renderer, {
    backgroundColor: api.theme.current.backgroundElement,
    border: false,
    cursorColor: api.theme.current.primary,
    height: 2,
    hideCmdline: true,
    hideEndOfBuffer: true,
    hideStatusline: true,
    onChange(event) {
      currentPrompt = {
        ...currentPrompt,
        input: event.value,
      };
      if (event.value.length === 0 && placeholder) {
        void editor.setVirtualText({
          chunks: [
            {
              color: placeholderColor,
              text: placeholder,
            },
          ],
          col: 0,
          line: 0,
          position: "overlay",
        });
        return;
      }

      void editor.clearVirtualText();
    },
    onModeChange(event) {
      setModeLabel(formatModeLabel(event.mode));
    },
    onReady() {
      setModeLabel(formatModeLabel(editor.getMode()));
      if (!placeholder) return;
      void editor.setVirtualText({
        chunks: [
          {
            color: placeholderColor,
            text: placeholder,
          },
        ],
        col: 0,
        line: 0,
        position: "overlay",
      });
    },
    selectionBg: api.theme.current.backgroundElement,
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
      void editor.setValue(prompt.input).then(() => {
        if (prompt.input.length === 0 && placeholder) {
          return editor.setVirtualText({
            chunks: [
              {
                color: placeholderColor,
                text: placeholder,
              },
            ],
            col: 0,
            line: 0,
            position: "overlay",
          });
        }

        return editor.clearVirtualText();
      });
    },
    reset() {
      currentPrompt = {
        input: "",
        mode: "normal",
        parts: [],
      };
      void editor.setValue("").then(() => {
        if (!placeholder) return;
        return editor.setVirtualText({
          chunks: [
            {
              color: placeholderColor,
              text: placeholder,
            },
          ],
          col: 0,
          line: 0,
          position: "overlay",
        });
      });
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
  onCleanup(() => slotProps.ref?.(undefined));

  setTimeout(() => editor.focus(), 1);

  return (
    <DefaultHomePromptMirror
      agentsKeyHint={api.keybind.print("agent_cycle")}
      api={api}
      commandsKeyHint={api.keybind.print("command_list")}
      input={editor}
      modeLabel={modeLabel()}
      onInputMouseDown={() => {
        editor.focus();
      }}
    >
      <DefaultHomePromptRight api={api} workspace_id={slotProps.workspace_id} />
    </DefaultHomePromptMirror>
  );
}

const tui: TuiPlugin = async (api) => {
  api.slots.register({
    slots: {
      home_prompt(
        _ctx: TuiSlotContext,
        slotProps: TuiHostSlotMap["home_prompt"],
      ) {
        return <HomePrompt api={api} slotProps={slotProps} />;
      },
    },
  });
};

export default {
  id: "nvim-prompt-replace",
  tui,
} satisfies TuiPluginModule & { id: string };
