# Proposed API Shape
```ts
import type { BoxOptions, ColorInput } from "@opentui/core";
type NvimMode = string;
type NvimPosition = {
  line: number;   // buffer line (0-based)
  col: number;    // buffer col (0-based)
  row?: number;   // screen row if relevant
  grid?: number;  // nvim ui grid if relevant
};
type NvimCompletionItem = {
  word: string;
  abbr?: string;
  kind?: string;
  menu?: string;
  info?: string;
  data?: unknown; // app payload
};
type NvimRenderableOptions = BoxOptions<NvimRenderable> & {
  // process/bootstrap
  argv?: string[];
  logRpc?: boolean;
  // editor-ish behavior
  value?: string;
  wrapMode?: "none" | "char" | "word";
  tabSize?: number;
  // line number config
  lineNumbers?: boolean | {
    relative?: boolean;
    current?: boolean;
    width?: number | "auto";
  };
  // nvim/editor colors (ColorInput like other OpenTUI renderables)
  textColor?: ColorInput;
  selectionFg?: ColorInput;
  selectionBg?: ColorInput;
  cursorColor?: ColorInput;
  lineNumberFg?: ColorInput;
  lineNumberBg?: ColorInput;
  // backgroundColor/borderColor/focusedBorderColor come from BoxOptions
  // callbacks
  onReady?: () => void;
  onChange?: (e: {
    value: string;
    changedtick?: number;
    cursor: NvimPosition;
    mode: NvimMode;
  }) => void;
  onModeChange?: (e: {
    mode: NvimMode;
    previousMode: NvimMode;
    cursorShape?: "block" | "line" | "underline";
  }) => void;
  onCursorChange?: (e: { cursor: NvimPosition; mode: NvimMode }) => void;
  // popupmenu (assuming your "optmenu" means ext_popupmenu)
  completion?: {
    enabled?: boolean;
    onShow?: (e: {
      items: NvimCompletionItem[];
      selected: number;
      anchor: { row: number; col: number; grid: number };
    }) => void;
    onSelect?: (e: {
      index: number;
      item: NvimCompletionItem | null;
      anchor: { row: number; col: number; grid: number };
      cursor: NvimPosition;
    }) => void;
    onConfirm?: (e: {
      index: number;
      item: NvimCompletionItem;
      cursor: NvimPosition;
    }) => void;
    onHide?: () => void;
  };
};
Imperative Methods To Expose
- getValue(): Promise<string>
- setValue(text: string): Promise<void>
- getMode(): NvimMode
- showCompletion(items: NvimCompletionItem[], opts?: { startCol?: number; selected?: number }): Promise<void>
- updateCompletion(items: NvimCompletionItem[]): Promise<void>
- hideCompletion(): Promise<void>
- selectCompletion(index: number, opts?: { insert?: boolean; finish?: boolean }): Promise<void>
Usage Sketch
const nvim = new NvimRenderable(renderer, {
  flexGrow: 1,
  border: true,
  backgroundColor: "#0b1220",
  borderColor: "#334155",
  lineNumbers: { relative: true, current: true },
  onChange: ({ value }) => {
    // sync app state
  },
  onModeChange: ({ mode }) => {
    statusBar.mode = mode;
  },
  completion: {
    enabled: true,
    onSelect: ({ item, cursor }) => {
      if (item) console.log("selected", item.word, cursor);
    },
    onConfirm: ({ item, cursor }) => {
      console.log("confirmed", item.word, cursor);
    },
  },
});
// app-driven completion injection
await nvim.showCompletion([
  { word: "requestRender", kind: "method", menu: "opentui" },
  { word: "renderSelf", kind: "method", menu: "opentui" },
]);
```
