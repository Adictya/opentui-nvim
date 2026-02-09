import {
  BoxRenderable,
  KeyEvent,
  MouseEvent,
  OptimizedBuffer,
  RGBA,
  TextAttributes,
  type BoxOptions,
  type RenderContext,
} from "@opentui/core";
import * as child_process from "node:child_process";
import * as assert from "node:assert";
import { Neovim, type NeovimClient, Window } from "neovim";
import { attach, findNvim } from "neovim";
import {
  clamp,
  createNvimLogger,
  keyEventToNvimInput,
  nvimRgbToRgba,
  toNvimInt,
  type NvimHlAttrs,
} from "./nvim";
import { getLogger } from "./logger";

export type NvimRenderableOptions = {
  argv?: string[];
  logRpc?: boolean;
  border?: boolean;
};

type Cell = { ch: string; hl: number };

const renderLogger = getLogger("NvimRenderable");

export class NvimRenderable extends BoxRenderable {
  private neovimClient: NeovimClient;
  private argv: string[];

  private gridW = 0;
  private gridH = 0;
  private grid: Cell[] = [];

  private cursorRow = 0;
  private cursorCol = 0;

  private hl = new Map<number, { fg?: RGBA; bg?: RGBA; attr: number }>();

  private defaultFg = RGBA.fromInts(256, 256, 256);
  private defaultBg = RGBA.fromInts(0, 0, 0, 10);

  private currentVimMode: string = "normal";
  private modeInfo: Array<{
    name: string;
    short_name?: string;
    cursor_shape?: string;
    cell_percentage?: number;
    blinkwait?: number;
    blinkon?: number;
    blinkoff?: number;
  }> = [];

  constructor(ctx: RenderContext, options: NvimRenderableOptions = {}) {
    super(ctx, {
      ...options,
      buffered: true,
      border: false,
      flexGrow: 1,
    } as BoxOptions);
    this.argv = options.argv ?? ["--headless", "--embed"];
    this._focusable = true;

    const found = findNvim({ orderBy: "desc", minVersion: "0.9.0" });
    assert.ok(found.matches[0]);

    const nvim_proc = child_process.spawn(found.matches[0].path, this.argv, {});
    this.neovimClient = attach({
      proc: nvim_proc,
      options: {
        logger: createNvimLogger(!!options.logRpc),
      },
    });
    this.neovimClient.on("notification", (method: string, args: unknown[]) => {
      if (method === "redraw") {
        this.applyRedrawEvents(args);
      }
      // console.log("recieved", ...args);
    });

    const self = this;
    (async () => {
      await self.neovimClient.uiAttach(this.width || 1, this.height || 1, {
        ext_linegrid: true,
        ext_multigrid: false,
        ext_cmdline: false,
        ext_popupmenu: false,
        rgb: true,
      });
    })();
  }

  private getContentRect() {
    const rect = this.getScissorRect();
    return {
      x: rect.x,
      y: rect.y,
      width: rect.width,
      height: rect.height,
    };
  }

  private parseHl(attrs: NvimHlAttrs) {
    let fg =
      attrs.foreground !== undefined
        ? nvimRgbToRgba(attrs.foreground)
        : undefined;
    let bg =
      attrs.background !== undefined
        ? nvimRgbToRgba(attrs.background)
        : undefined;

    let bits = TextAttributes.NONE;
    if (attrs.bold) bits |= TextAttributes.BOLD;
    if (attrs.italic) bits |= TextAttributes.ITALIC;
    if (attrs.underline || attrs.undercurl || attrs.underdouble)
      bits |= TextAttributes.UNDERLINE;
    if (attrs.strikethrough) bits |= TextAttributes.STRIKETHROUGH;

    if (attrs.reverse) {
      const tmp = fg;
      fg = bg;
      bg = tmp;
      bits |= TextAttributes.INVERSE;
    }

    return { fg, bg, attr: bits };
  }

  private resizeGrid(w: number, h: number) {
    const newW = Math.max(0, w);
    const newH = Math.max(0, h);

    const newGrid: Cell[] = new Array(newW * newH);
    for (let i = 0; i < newGrid.length; i++) {
      newGrid[i] = { ch: " ", hl: 0 };
    }

    const copyH = Math.min(this.gridH, newH);
    const copyW = Math.min(this.gridW, newW);
    for (let y = 0; y < copyH; y++) {
      for (let x = 0; x < copyW; x++) {
        const oldIdx = y * this.gridW + x;
        const newIdx = y * newW + x;
        const oldCell = this.grid[oldIdx];
        if (oldCell) {
          newGrid[newIdx] = { ch: oldCell.ch, hl: oldCell.hl };
        }
      }
    }

    this.gridW = newW;
    this.gridH = newH;
    this.grid = newGrid;
  }

  private clearGrid() {
    for (let i = 0; i < this.grid.length; i++) {
      const cell = this.grid[i];
      if (!cell) continue;
      cell.ch = " ";
      cell.hl = 0;
    }
  }

  private scrollGrid(
    top: number,
    bot: number,
    left: number,
    right: number,
    rows: number,
    cols: number,
  ) {
    if (this.gridW === 0 || this.gridH === 0) return;
    const t = clamp(top, 0, this.gridH);
    const b = clamp(bot, 0, this.gridH);
    const l = clamp(left, 0, this.gridW);
    const r = clamp(right, 0, this.gridW);
    const h = b - t;
    const w = r - l;
    if (h <= 0 || w <= 0) return;

    const tmp: Cell[] = new Array(w * h);
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const idx = (t + y) * this.gridW + (l + x);
        const c = this.grid[idx];
        tmp[y * w + x] = c ? { ch: c.ch, hl: c.hl } : { ch: " ", hl: 0 };
        if (c) {
          c.ch = " ";
          c.hl = 0;
        }
        const destY = y - rows;
        const destX = x - cols;
        if (destY < 0 || destY >= h || destX < 0 || destX >= w) continue;
        const src = tmp[y * w + x];
        if (!src) continue;
        const dstIdx = (t + destY) * this.gridW + (l + destX);
        const cd = this.grid[dstIdx];
        if (cd) {
          cd.ch = src.ch;
          cd.hl = src.hl;
        }
      }
    }
  }

  private applyGridLine(row: number, colStart: number, cells: unknown[]) {
    if (row < 0 || row >= this.gridH) return;
    let col = colStart;
    let currentHl = 0;

    for (const rawCell of cells) {
      if (!Array.isArray(rawCell) || rawCell.length === 0) continue;
      const text = rawCell[0];
      if (typeof text !== "string") continue;

      if (typeof rawCell[1] === "number") currentHl = rawCell[1];
      let repeat = typeof rawCell[2] === "number" ? rawCell[2] : 1;
      // if (repeat === 0) {
      //   // Neovim sometimes uses 0 as a compact "repeat to end of line".
      //   repeat = Math.max(0, this.gridW - col);
      // }
      const chars = Array.from(text);

      if (row <= 2)
        renderLogger.info("line", {
          chars,
          row,
          col,
          repeat,
          hl: rawCell[1],
        });

      for (let rep = 0; rep < repeat; rep++) {
        for (const ch of chars) {
          if (col >= this.gridW) break;
          if (col >= 0) {
            const idx = row * this.gridW + col;
            const cell = this.grid[idx];
            if (cell) {
              cell.ch = ch.length === 0 ? " " : ch;
              cell.hl = currentHl === undefined ? cell.hl : currentHl;
            }
          }
          col++;
        }
      }
    }
  }

  private applyRedrawEvents(events: unknown[]) {
    for (const ev of events) {
      if (!Array.isArray(ev) || ev.length === 0) continue;
      const [name, ...args] = ev as [string, ...unknown[]];

      renderLogger.debug(`redraw.${name}`, name !== "grid_line" ? args : []);

      switch (name) {
        case "default_colors_set": {
          // Calls: [rgb_fg, rgb_bg, rgb_sp, cterm_fg, cterm_bg]
          for (const call of args) {
            if (!Array.isArray(call) || call.length < 2) continue;
            const fg = call[0];
            const bg = call[1];
            if (typeof fg === "number") this.defaultFg = nvimRgbToRgba(fg);
            if (typeof bg === "number") this.defaultBg = nvimRgbToRgba(bg);
            this.requestRender();
          }
          break;
        }
        case "hl_attr_define": {
          for (const def of args) {
            if (!Array.isArray(def) || def.length < 3) continue;
            const [id, rgbAttrs] = def as [
              number,
              NvimHlAttrs,
              unknown,
              unknown,
            ];
            if (
              typeof id !== "number" ||
              typeof rgbAttrs !== "object" ||
              !rgbAttrs
            )
              continue;

            this.hl.set(id, this.parseHl(rgbAttrs));
            if (id == 0) renderLogger.info("default hl", this.hl.get(0));
          }
          break;
        }
        case "grid_resize": {
          for (const call of args) {
            if (!Array.isArray(call) || call.length < 3) continue;
            const [grid, w, h] = call as [number, number, number];
            if (typeof w === "number" && typeof h === "number") {
              this.resizeGrid(w, h);
              this.requestRender();
            }
          }
          break;
        }
        case "grid_clear": {
          for (const call of args) {
            if (!Array.isArray(call) || call.length < 1) continue;
            const [grid] = call as [number];
            this.clearGrid();
            this.requestRender();
          }
          break;
        }
        case "grid_cursor_goto": {
          for (const call of args) {
            if (!Array.isArray(call) || call.length < 3) continue;
            const [grid, row, col] = call as [number, number, number];
            // if (typeof row === "number") this.cursorRow = row;
            // if (typeof col === "number") this.cursorCol = col;

            if (this.focused) {
              const x = this.x + col;
              const y = this.y + row;
              this.ctx.setCursorPosition(x + 1, y + 1, true);

              const cursorStyle = this.getCursorStyleForMode();
              this.ctx.setCursorStyle(cursorStyle, false);
            } else {
              this.ctx.setCursorPosition(1, 1, false);
            }
          }
          this.requestRender();
          break;
        }
        case "grid_scroll": {
          for (const call of args) {
            if (!Array.isArray(call) || call.length < 7) continue;
            const [grid, top, bot, left, right, rows, cols] = call as [
              number,
              number,
              number,
              number,
              number,
              number,
              number,
            ];
            this.scrollGrid(top, bot, left, right, rows, cols);
            this.requestRender();
          }
          break;
        }
        case "grid_line": {
          for (const call of args) {
            if (!Array.isArray(call) || call.length < 5) continue;
            const [grid, row, colStart, cells] = call as [
              number,
              number,
              number,
              unknown[],
              boolean,
            ];
            if (
              typeof row !== "number" ||
              typeof colStart !== "number" ||
              !Array.isArray(cells)
            ) {
              continue;
            }
            this.applyGridLine(row, colStart, cells);
            this.requestRender();
          }
          break;
        }
        case "mode_info_set": {
          for (const call of args) {
            if (!Array.isArray(call) || call.length < 2) continue;
            const [, modeInfoArray] = call as [
              boolean,
              Array<Record<string, unknown>>,
            ];
            if (Array.isArray(modeInfoArray)) {
              this.modeInfo = modeInfoArray.map((info) => ({
                name: String(info.name || ""),
                short_name: String(info.short_name || ""),
                cursor_shape: String(info.cursor_shape || "block"),
                cell_percentage: Number(info.cell_percentage || 0),
                blinkwait: Number(info.blinkwait || 0),
                blinkon: Number(info.blinkon || 0),
                blinkoff: Number(info.blinkoff || 0),
              }));
            }
          }
          break;
        }
        case "mode_change": {
          for (const call of args) {
            if (!Array.isArray(call) || call.length < 2) continue;
            const [modeName] = call as [string, number];
            if (typeof modeName === "string") {
              this.currentVimMode = modeName;
            }
            const cursorStyle = this.getCursorStyleForMode();
            this.ctx.setCursorStyle(cursorStyle, false);
          }
          break;
        }
        case "flush": {
          break;
        }
        default: {
        }
      }
    }
  }

  private getCursorStyleForMode(): "block" | "line" | "underline" {
    const modeInfo = this.modeInfo.find((m) => m.name === this.currentVimMode);
    if (modeInfo?.cursor_shape) {
      switch (modeInfo.cursor_shape) {
        case "vertical":
          return "line";
        case "horizontal":
          return "underline";
        case "block":
        default:
          return "block";
      }
    }

    // Default mappings if mode_info not available
    switch (this.currentVimMode) {
      case "insert":
      case "cmdline_insert":
        return "line";
      case "replace":
      case "cmdline_replace":
        return "underline";
      case "normal":
      case "visual":
      case "visual_select":
      case "cmdline_normal":
      case "operator":
      default:
        return "block";
    }
  }

  protected override async onResize(width: number, height: number) {
    super.onResize(width, height);

    const rect = this.getContentRect();
    renderLogger.info("Parsing onResize", { width, height, rect });
    const cols = toNvimInt(rect.width, 1);
    const rows = toNvimInt(rect.height, 1);
    await this.neovimClient.uiTryResize(cols, rows);
  }

  private resolveStyle(hlId: number) {
    const s = this.hl.get(hlId);
    return {
      fg: s?.fg ?? this.defaultFg,
      bg: s?.bg ?? this.defaultBg,
      attr: s?.attr ?? 0,
    };
  }

  override handleKeyPress(key: KeyEvent) {
    if (key.name === "escape" && this.currentVimMode === "normal") {
      key.preventDefault();
      this.blur();
      return true;
    }

    const input = keyEventToNvimInput(key);
    if (!input) return false;
    renderLogger.info("sending input", key.name, key.ctrl);
    void this.neovimClient.input(input);
    key.preventDefault();
    return true;
  }

  protected override renderSelf(buffer: OptimizedBuffer) {
    // super.renderSelf(buffer);

    const rect = this.getContentRect();
    renderLogger.info("Rendered", rect, this.y);

    if (this.gridW === 0 || this.gridH === 0) {
      buffer.drawText(
        "Neovim attached, waiting for redraw...",
        rect.x,
        rect.y,
        RGBA.fromInts(256, 256, 256),
        RGBA.fromInts(0, 0, 0, 0),
      );
      return;
    }
    const drawW = Math.min(rect.width, this.gridW);
    const drawH = Math.min(rect.height, this.gridH);

    for (let y = 0; y < drawH; y++) {
      for (let x = 0; x < drawW; x++) {
        const idx = y * this.gridW + x;
        const cell = this.grid[idx];
        const style = this.resolveStyle(cell?.hl ?? 0);
        buffer.setCell(
          rect.x + x,
          rect.y + y,
          cell?.ch ?? " ",
          style.fg,
          style.bg,
          style.attr,
        );
      }
    }
  }
}
