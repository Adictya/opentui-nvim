import { createCliRenderer, TextRenderable } from "@opentui/core";
import * as fs from "node:fs";
import * as path from "node:path";
import { type NeovimClient } from "neovim";
import {
  NvimRenderable,
  type NvimCompletionItem,
  type NvimRenderableOptions,
} from "../../src/NvimRenderable";

type HarnessConfig = {
  commandsFile: string;
  resultsFile: string;
  eventsFile: string;
  pollIntervalMs?: number;
  options?: HarnessOptions;
};

type HarnessOptions = {
  argv?: string[];
  logRpc?: boolean;
  value?: string;
  wrapMode?: "none" | "char" | "word";
  tabSize?: number;
  lineNumbers?:
    | boolean
    | {
        relative?: boolean;
        current?: boolean;
        width?: number | "auto";
      };
  textColor?: string;
  selectionFg?: string;
  selectionBg?: string;
  cursorColor?: string;
  lineNumberFg?: string;
  lineNumberBg?: string;
  completion?: {
    enabled?: boolean;
  };
};

type HarnessEvent = {
  type:
    | "harness_started"
    | "ready"
    | "change"
    | "mode_change"
    | "cursor_change"
    | "completion_show"
    | "completion_select"
    | "completion_confirm"
    | "completion_hide"
    | "harness_stopped";
  timestamp: string;
  [key: string]: unknown;
};

type HarnessCommand = {
  id: string;
  action:
    | "ping"
    | "focus"
    | "blur"
    | "getValue"
    | "setValue"
    | "getMode"
    | "showCompletion"
    | "updateCompletion"
    | "hideCompletion"
    | "selectCompletion"
    | "debugNvimChild"
    | "debugGetBoundBufferId"
    | "debugGetCurrentBufferId"
    | "debugListBufferIds"
    | "debugGetOption"
    | "debugCommandOutput"
    | "debugCommand"
    | "debugHighlight"
    | "exit";
  payload?: unknown;
};

type HarnessResult = {
  id: string;
  ok: boolean;
  timestamp: string;
  value?: unknown;
  error?: string;
};

function nowIso() {
  return new Date().toISOString();
}

function asObject(value: unknown): Record<string, unknown> {
  if (value && typeof value === "object") {
    return value as Record<string, unknown>;
  }
  return {};
}

function appendJsonLine(filePath: string, value: unknown) {
  fs.appendFileSync(filePath, `${JSON.stringify(value)}\n`, "utf8");
}

function parseCliArgs(argv: string[]): { configPath: string } {
  const configFlagIndex = argv.findIndex((part) => part === "--config");
  if (configFlagIndex < 0) {
    throw new Error("Missing required --config argument");
  }

  const configPath = argv[configFlagIndex + 1];
  if (!configPath) {
    throw new Error("Missing value for --config argument");
  }

  return { configPath: path.resolve(process.cwd(), configPath) };
}

function readConfig(configPath: string): HarnessConfig {
  const raw = fs.readFileSync(configPath, "utf8");
  return JSON.parse(raw) as HarnessConfig;
}

function ensureParentDirectory(filePath: string) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
}

function readCommandLines(commandsFile: string): string[] {
  if (!fs.existsSync(commandsFile)) {
    return [];
  }

  const raw = fs.readFileSync(commandsFile, "utf8");
  if (!raw) {
    return [];
  }

  return raw.split(/\r?\n/).filter((line) => line.trim().length > 0);
}

function getClient(renderable: NvimRenderable): NeovimClient {
  return (renderable as unknown as { neovimClient: NeovimClient }).neovimClient;
}

function getBoundBufferId(renderable: NvimRenderable): number | null {
  return (renderable as unknown as { boundBufferId: number | null })
    .boundBufferId;
}

function getNvimProcess(renderable: NvimRenderable): {
  pid: number | undefined;
  spawnargs: string[];
} {
  const processInfo = (
    renderable as unknown as {
      nvimProcess?: {
        pid?: number;
        spawnargs?: string[];
      };
    }
  ).nvimProcess;

  return {
    pid: processInfo?.pid,
    spawnargs: processInfo?.spawnargs ?? [],
  };
}

async function run() {
  const { configPath } = parseCliArgs(process.argv.slice(2));
  const config = readConfig(configPath);

  ensureParentDirectory(config.commandsFile);
  ensureParentDirectory(config.resultsFile);
  ensureParentDirectory(config.eventsFile);

  if (!fs.existsSync(config.commandsFile)) {
    fs.writeFileSync(config.commandsFile, "", "utf8");
  }
  fs.writeFileSync(config.resultsFile, "", "utf8");
  fs.writeFileSync(config.eventsFile, "", "utf8");

  const pushEvent = (event: Omit<HarnessEvent, "timestamp">) => {
    const eventLine = {
      ...event,
      timestamp: nowIso(),
    } as HarnessEvent;
    appendJsonLine(config.eventsFile, eventLine);
  };

  const pushResult = (result: HarnessResult) => {
    appendJsonLine(config.resultsFile, result);
  };

  pushEvent({
    type: "harness_started",
    pid: process.pid,
    ppid: process.ppid,
    cwd: process.cwd(),
    configPath,
  });

  const renderer = await createCliRenderer({
    useMouse: false,
    useAlternateScreen: true,
  });

  const header = new TextRenderable(renderer, {
    content: "Nvim API harness",
    width: "100%",
    height: 1,
  });

  const status = new TextRenderable(renderer, {
    content: "booting...",
    width: "100%",
    height: 1,
  });

  renderer.root.add(header);
  renderer.root.add(status);

  let changeCount = 0;

  const nvim = new NvimRenderable(renderer, {
    ...(config.options as NvimRenderableOptions),
    onReady: () => {
      pushEvent({ type: "ready" });
      status.content = "ready";
    },
    onChange: ({ value, changedtick, cursor, mode }) => {
      changeCount += 1;
      pushEvent({
        type: "change",
        count: changeCount,
        value,
        changedtick,
        cursor,
        mode,
      });
      const firstLine = value.split("\n", 1)[0] ?? "";
      status.content = `change=${changeCount} mode=${mode} line=${cursor.line} col=${cursor.col} first=${firstLine}`;
    },
    onModeChange: ({ mode, previousMode, cursorShape }) => {
      pushEvent({
        type: "mode_change",
        mode,
        previousMode,
        cursorShape,
      });
    },
    onCursorChange: ({ cursor, mode }) => {
      pushEvent({ type: "cursor_change", cursor, mode });
    },
    completion: {
      enabled: config.options?.completion?.enabled,
      onShow: ({ items, selected, anchor }) => {
        pushEvent({ type: "completion_show", items, selected, anchor });
      },
      onSelect: ({ index, item, anchor, cursor }) => {
        pushEvent({ type: "completion_select", index, item, anchor, cursor });
      },
      onConfirm: ({ index, item, cursor }) => {
        pushEvent({ type: "completion_confirm", index, item, cursor });
      },
      onHide: () => {
        pushEvent({ type: "completion_hide" });
      },
    },
  });

  renderer.root.add(nvim);
  nvim.focus();

  let stopping = false;
  const requestStop = () => {
    stopping = true;
  };
  process.on("SIGINT", requestStop);
  process.on("SIGTERM", requestStop);

  let processedCommandCount = 0;
  const pollIntervalMs = Math.max(5, config.pollIntervalMs ?? 20);

  const executeCommand = async (command: HarnessCommand): Promise<unknown> => {
    const payload = asObject(command.payload);
    const client = getClient(nvim);

    switch (command.action) {
      case "ping":
        return "pong";
      case "focus":
        nvim.focus();
        return true;
      case "blur":
        nvim.blur();
        return true;
      case "getValue":
        return await nvim.getValue();
      case "setValue": {
        const text =
          typeof payload.text === "string"
            ? payload.text
            : String(payload.text ?? "");
        await nvim.setValue(text);
        return true;
      }
      case "getMode":
        return nvim.getMode();
      case "showCompletion": {
        const items = (payload.items ?? []) as NvimCompletionItem[];
        const opts = asObject(payload.opts);
        const startCol =
          typeof opts.startCol === "number"
            ? Math.floor(opts.startCol)
            : undefined;
        const selected =
          typeof opts.selected === "number"
            ? Math.floor(opts.selected)
            : undefined;
        await nvim.showCompletion(items, { startCol, selected });
        return true;
      }
      case "updateCompletion": {
        const items = (payload.items ?? []) as NvimCompletionItem[];
        await nvim.updateCompletion(items);
        return true;
      }
      case "hideCompletion":
        await nvim.hideCompletion();
        return true;
      case "selectCompletion": {
        const index =
          typeof payload.index === "number" ? Math.floor(payload.index) : -1;
        const opts = asObject(payload.opts);
        await nvim.selectCompletion(index, {
          insert: opts.insert === true,
          finish: opts.finish === true,
        });
        return true;
      }
      case "debugNvimChild": {
        const processInfo = getNvimProcess(nvim);
        return {
          pid: processInfo.pid ?? null,
          spawnargs: processInfo.spawnargs,
        };
      }
      case "debugGetBoundBufferId":
        return getBoundBufferId(nvim);
      case "debugGetCurrentBufferId": {
        const currentBuffer = await client.buffer;
        return currentBuffer.id;
      }
      case "debugListBufferIds": {
        const buffers = await client.buffers;
        return buffers.map((buffer) => buffer.id);
      }
      case "debugGetOption": {
        const name =
          typeof payload.name === "string" && payload.name.length > 0
            ? payload.name
            : "";
        if (!name) {
          throw new Error("debugGetOption requires payload.name");
        }

        const scope = payload.scope;
        if (scope === "global") {
          return await client.getOption(name);
        }
        if (scope === "window") {
          const window = await client.window;
          return await window.getOption(name);
        }

        const boundBuffer = await client.buffer;
        return await boundBuffer.getOption(name);
      }
      case "debugCommandOutput": {
        const commandText =
          typeof payload.command === "string" ? payload.command : "";
        if (!commandText) {
          throw new Error("debugCommandOutput requires payload.command");
        }
        return await client.commandOutput(commandText);
      }
      case "debugCommand": {
        const commandText =
          typeof payload.command === "string" ? payload.command : "";
        if (!commandText) {
          throw new Error("debugCommand requires payload.command");
        }
        await client.command(commandText);
        return true;
      }
      case "debugHighlight": {
        const groupName =
          typeof payload.name === "string" && payload.name.length > 0
            ? payload.name
            : "";
        if (!groupName) {
          throw new Error("debugHighlight requires payload.name");
        }

        try {
          return await client.call("nvim_get_hl", [
            0,
            { name: groupName, link: false },
          ]);
        } catch {
          return await client.getHighlightByName(groupName, true);
        }
      }
      case "exit":
        requestStop();
        return true;
      default:
        throw new Error(`Unknown command action: ${String(command.action)}`);
    }
  };

  while (!stopping) {
    const rawLines = readCommandLines(config.commandsFile);

    while (processedCommandCount < rawLines.length) {
      const rawLine = rawLines[processedCommandCount];

      if (!rawLine) {
        break;
      }

      let parsedCommand: HarnessCommand;
      try {
        parsedCommand = JSON.parse(rawLine) as HarnessCommand;
      } catch {
        break;
      }

      processedCommandCount += 1;

      try {
        const value = await executeCommand(parsedCommand);
        pushResult({
          id: parsedCommand.id,
          ok: true,
          timestamp: nowIso(),
          value,
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        pushResult({
          id: parsedCommand.id,
          ok: false,
          timestamp: nowIso(),
          error: message,
        });
      }
    }

    await Bun.sleep(pollIntervalMs);
  }

  pushEvent({ type: "harness_stopped" });
  process.exit(0);
}

void run();
