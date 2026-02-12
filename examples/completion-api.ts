import { createCliRenderer, TextRenderable } from "@opentui/core";
import { NvimRenderable, type NvimCompletionItem } from "../src/NvimRenderable";

type ChangeEvent = {
  value: string;
  mode: string;
};

const completionCatalog: NvimCompletionItem[] = [
  { word: "render", kind: "method", menu: "opentui" },
  { word: "requestRender", kind: "method", menu: "opentui" },
  { word: "renderSelf", kind: "method", menu: "opentui" },
  { word: "setValue", kind: "method", menu: "opentui" },
  { word: "getValue", kind: "method", menu: "opentui" },
  { word: "showCompletion", kind: "method", menu: "opentui" },
  { word: "updateCompletion", kind: "method", menu: "opentui" },
  { word: "hideCompletion", kind: "method", menu: "opentui" },
  { word: "selectCompletion", kind: "method", menu: "opentui" },
  { word: "cursorColor", kind: "property", menu: "opentui" },
  { word: "lineNumbers", kind: "property", menu: "opentui" },
  { word: "tabSize", kind: "property", menu: "opentui" },
  { word: "wrapMode", kind: "property", menu: "opentui" },
  { word: "completion", kind: "property", menu: "opentui" },
];

const methodCompletions = completionCatalog.filter(
  (item) => item.kind === "method",
);

function isInsertLike(mode: string): boolean {
  return mode === "i" || mode.includes("insert");
}

function getInsertedText(previous: string, next: string): string {
  if (next.length <= previous.length) return "";

  let start = 0;
  while (
    start < previous.length &&
    start < next.length &&
    previous[start] === next[start]
  ) {
    start += 1;
  }

  let prevEnd = previous.length - 1;
  let nextEnd = next.length - 1;
  while (
    prevEnd >= start &&
    nextEnd >= start &&
    previous[prevEnd] === next[nextEnd]
  ) {
    prevEnd -= 1;
    nextEnd -= 1;
  }

  return next.slice(start, nextEnd + 1);
}

const renderer = await createCliRenderer({
  useMouse: false,
  useAlternateScreen: true,
});

const title = new TextRenderable(renderer, {
  content: "Completion API Demo (Ctrl+C to exit)",
  width: "100%",
  height: 1,
});

const help = new TextRenderable(renderer, {
  content:
    "Triggers in insert mode: '.' show | '!' update | ';' hide | '?' select first",
  width: "100%",
  height: 1,
});

const status = new TextRenderable(renderer, {
  content: "Waiting for onReady...",
  width: "100%",
  height: 1,
});

renderer.root.add(title);
renderer.root.add(help);
renderer.root.add(status);

let nvim: NvimRenderable | null = null;
let ready = false;
let visibleCompletion = false;
let lastValue = "";

const runCompletionPipeline = async (event: ChangeEvent) => {
  if (!nvim) return;

  if (event.value === lastValue) return;
  const inserted = getInsertedText(lastValue, event.value);
  lastValue = event.value;

  if (!ready || !isInsertLike(event.mode)) {
    return;
  }

  const lastChar = inserted.at(-1);

  if (lastChar === ".") {
    await nvim.showCompletion(completionCatalog, { selected: -1 });
    visibleCompletion = true;
    status.content = "showCompletion() -> all items";
    return;
  }

  if (lastChar === "!") {
    if (visibleCompletion) {
      await nvim.updateCompletion(methodCompletions);
    } else {
      await nvim.showCompletion(methodCompletions, { selected: -1 });
      visibleCompletion = true;
    }
    status.content = "updateCompletion() -> method items";
    return;
  }

  if (lastChar === ";") {
    if (visibleCompletion) {
      await nvim.hideCompletion();
      visibleCompletion = false;
    }
    status.content = "hideCompletion()";
    return;
  }

  if (lastChar === "?") {
    if (!visibleCompletion) {
      await nvim.showCompletion(completionCatalog, { selected: 0 });
      visibleCompletion = true;
    }
    await nvim.selectCompletion(0, { insert: true, finish: true });
    status.content = "selectCompletion(0, { insert: true, finish: true })";
  }
};

const editor = new NvimRenderable(renderer, {
  flexGrow: 1,
  border: true,
  lineNumbers: { relative: true, current: true },
  wrapMode: "none",
  tabSize: 2,
  value: "api",
  onReady: () => {
    ready = true;
    if (nvim) {
      const client = (
        nvim as unknown as {
          neovimClient: { command: (command: string) => Promise<void> };
        }
      ).neovimClient;
      void client.command("set completeopt=menu,menuone,noselect,noinsert");
    }
    status.content =
      "Ready. Press i and type . ! ; ? to drive completion methods.";
  },
  onChange: (event) => {
    void runCompletionPipeline(event);
  },
  onModeChange: ({ mode, previousMode }) => {
    status.content = `mode: ${previousMode} -> ${mode}`;
  },
  completion: {
    enabled: true,
    onShow: ({ items, selected }) => {
      visibleCompletion = true;
      status.content = `popupmenu show: ${items.length} items selected=${selected}`;
    },
    onSelect: ({ index, item }) => {
      status.content = `popupmenu select: index=${index} word=${item?.word ?? "<none>"}`;
    },
    onConfirm: ({ index, item, cursor }) => {
      visibleCompletion = false;
      status.content = `popupmenu confirm: index=${index} word=${item.word} at ${cursor.line}:${cursor.col}`;
    },
    onHide: () => {
      visibleCompletion = false;
      status.content = "popupmenu hide";
    },
  },
});

nvim = editor;
renderer.root.add(editor);
editor.focus();
