import { KeyEvent, RGBA } from "@opentui/core";
import { formatWithOptions, inspect } from "node:util";
import { getLogger } from "./logger";

export type NvimHlAttrs = {
  bold?: boolean;
  italic?: boolean;
  underline?: boolean;
  underdouble?: boolean;
  undercurl?: boolean;
  strikethrough?: boolean;
  reverse?: boolean;
  foreground?: number;
  background?: number;
  special?: number;
};

export function nvimRgbToRgba(rgb: number) {
  // Neovim sends RGB as 0xRRGGBB (no alpha).
  const r = (rgb >> 16) & 0xff;
  const g = (rgb >> 8) & 0xff;
  const b = rgb & 0xff;
  return RGBA.fromInts(r, g, b, 255);
}

function applyMods(base: string, ctrl: boolean, alt: boolean, shift: boolean) {
  // base is like "<Esc>" or "<Left>" or "<x>".
  if (!base.startsWith("<") || !base.endsWith(">")) return base;
  const inner = base.slice(1, -1);
  const mods: string[] = [];
  if (ctrl) mods.push("C");
  if (alt) mods.push("M");
  if (shift) mods.push("S");
  if (mods.length === 0) return base;
  return `<${mods.join("-")}-${inner}>`;
}

export function keyEventToNvimInput(key: KeyEvent): string | null {
  // Prefer semantic mappings for special keys.
  const name = key.name;
  const ctrl = key.ctrl;
  const alt = key.meta || key.option;
  const shift = key.shift;

  // Basic named keys
  const special: Record<string, string> = {
    escape: "<Esc>",
    esc: "<Esc>",
    return: "<CR>",
    enter: "<CR>",
    backspace: "<BS>",
    delete: "<Del>",
    tab: "<Tab>",
    up: "<Up>",
    down: "<Down>",
    left: "<Left>",
    right: "<Right>",
    home: "<Home>",
    end: "<End>",
    pageup: "<PageUp>",
    pagedown: "<PageDown>",
    insert: "<Insert>",
  };

  if (name in special) {
    return applyMods(special[name]!, ctrl, alt, shift);
  }

  // Function keys: f1..f12
  if (/^f\d+$/.test(name)) {
    return applyMods(`<${name.toUpperCase()}>`, ctrl, alt, shift);
  }

  // Printable characters
  const seq = key.sequence;
  if (seq && seq.length > 0 && !ctrl && !alt) {
    return seq;
  }

  // Ctrl/Alt chords
  // Neovim uses <C-x> / <M-x> notation.
  if ((ctrl || alt) && name && name.length === 1) {
    const inner = name.toLowerCase();
    return applyMods(`<${inner}>`, ctrl, alt, shift);
  }

  // Fall back to raw sequence if present.
  if (key.raw && key.raw.length > 0) return key.raw;
  return null;
}

export function createNvimLogger(logRpc: boolean): any {
  // Neovim's Logger type is chainable (methods return Logger). Keep that shape
  // so we can pass it through while routing output to our shared logger.
  const rpcLogger = getLogger("NVIM_RPC");
  const formatArgs = (args: unknown[]) => {
    try {
      return formatWithOptions(
        {
          colors: false,
          depth: 5,
          breakLength: Infinity,
          compact: true,
        },
        ...(args as any[]),
      );
    } catch {
      return args
        .map((arg) =>
          typeof arg === "string"
            ? arg
            : inspect(arg, {
                depth: 5,
                breakLength: Infinity,
                compact: true,
              }),
        )
        .join(" ");
    }
  };

  const logger = {
    level: logRpc ? "debug" : "warn",
    debug: (...data: unknown[]) => {
      if (logRpc) rpcLogger.debug(formatArgs(data));
      return logger;
    },
    info: (...data: unknown[]) => {
      if (logRpc) rpcLogger.info(formatArgs(data));
      return logger;
    },
    warn: (...data: unknown[]) => {
      rpcLogger.warn(formatArgs(data));
      return logger;
    },
    error: (...data: unknown[]) => {
      rpcLogger.error(formatArgs(data));
      return logger;
    },
  };

  return logger;
}

export function toNvimInt(value: unknown, fallback: number) {
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(n)) return Math.max(1, Math.floor(fallback));
  const i = Math.floor(n);
  if (!Number.isSafeInteger(i)) return Math.max(1, Math.floor(fallback));
  return Math.max(1, i);
}

export function clamp(n: number, min: number, max: number) {
  return Math.min(max, Math.max(min, n));
}
