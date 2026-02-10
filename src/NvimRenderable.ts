import {
  BoxRenderable,
  KeyEvent,
  OptimizedBuffer,
  RGBA,
  TextAttributes,
  parseColor,
  type BoxOptions,
  type ColorInput,
  type RenderContext,
} from "@opentui/core";
import * as assert from "node:assert";
import * as child_process from "node:child_process";
import { attach, findNvim, type Buffer, type NeovimClient } from "neovim";
import {
  clamp,
  createNvimLogger,
  keyEventToNvimInput,
  nvimRgbToRgba,
  toNvimInt,
  type NvimHlAttrs,
} from "./nvim";
import { getLogger } from "./logger";

export type NvimMode = string;

export type NvimPosition = {
  line: number;
  col: number;
  row?: number;
  grid?: number;
};

export type NvimCompletionItem = {
  word: string;
  abbr?: string;
  kind?: string;
  menu?: string;
  info?: string;
  data?: unknown;
};

type CursorShape = "block" | "line" | "underline";

type CompletionAnchor = {
  row: number;
  col: number;
  grid: number;
};

export type NvimRenderableOptions = BoxOptions<NvimRenderable> & {
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
  textColor?: ColorInput;
  selectionFg?: ColorInput;
  selectionBg?: ColorInput;
  cursorColor?: ColorInput;
  lineNumberFg?: ColorInput;
  lineNumberBg?: ColorInput;
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
    cursorShape?: CursorShape;
  }) => void;
  onCursorChange?: (e: { cursor: NvimPosition; mode: NvimMode }) => void;
  completion?: {
    enabled?: boolean;
    onShow?: (e: {
      items: NvimCompletionItem[];
      selected: number;
      anchor: CompletionAnchor;
    }) => void;
    onSelect?: (e: {
      index: number;
      item: NvimCompletionItem | null;
      anchor: CompletionAnchor;
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

type Cell = { ch: string; hl: number };

const renderLogger = getLogger("NvimRenderable");

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function toNvimHex(color?: ColorInput): string | undefined {
  if (!color) return undefined;
  try {
    const parsed = parseColor(color);
    const [r, g, b] = parsed.toInts();
    const toHex = (value: number) =>
      clamp(Math.round(value), 0, 255).toString(16).padStart(2, "0");
    return `#${toHex(r)}${toHex(g)}${toHex(b)}`;
  } catch {
    return undefined;
  }
}

function toBufferLines(text: string): string[] {
  return text.replace(/\r\n/g, "\n").split("\n");
}

export class NvimRenderable extends BoxRenderable {
  private readonly options: NvimRenderableOptions;
  private readonly argv: string[];
  private readonly completionEnabled: boolean;
  private readonly nvimProcess: child_process.ChildProcess;

  private neovimClient: NeovimClient;
  private readonly bootPromise: Promise<void>;
  private shuttingDown = false;

  private gridW = 0;
  private gridH = 0;
  private grid: Cell[] = [];

  private cursorRow = 0;
  private cursorCol = 0;
  private cursorGrid = 1;
  private lastKnownCursor: NvimPosition = {
    line: 0,
    col: 0,
    row: 0,
    grid: 1,
  };
  private cursorSyncPending: CompletionAnchor | null = null;
  private cursorSyncInFlight = false;

  private hl = new Map<number, { fg?: RGBA; bg?: RGBA; attr: number }>();

  private defaultFg = RGBA.fromInts(255, 255, 255, 255);
  private defaultBg = RGBA.fromInts(0, 0, 0, 255);

  private currentVimMode: NvimMode = "normal";
  private modeInfo: Array<{
    name: string;
    short_name?: string;
    cursor_shape?: string;
    cell_percentage?: number;
    blinkwait?: number;
    blinkon?: number;
    blinkoff?: number;
  }> = [];

  private boundBuffer: Buffer | null = null;
  private boundBufferId: number | null = null;
  private boundBufferDisposers: Array<() => void> = [];
  private lastKnownChangedtick?: number;

  private shownCompletionItems: NvimCompletionItem[] = [];
  private popupmenuVisible = false;
  private popupmenuItems: NvimCompletionItem[] = [];
  private popupmenuSelected = -1;
  private popupmenuAnchor: CompletionAnchor = { row: 0, col: 0, grid: 0 };
  private lastCompletionStartCol = 0;
  private hideCompletionRequested = false;
  private pendingConfirmIndex: number | null = null;

  constructor(ctx: RenderContext, options: NvimRenderableOptions = {}) {
    super(ctx, {
      ...options,
      buffered: true,
      flexGrow: options.flexGrow ?? 1,
    } as BoxOptions);

    this.options = options;
    this.argv = options.argv ?? ["--clean", "--headless", "--embed"];
    this.completionEnabled = options.completion
      ? options.completion.enabled !== false
      : false;
    this._focusable = true;

    const found = findNvim({ orderBy: "desc", minVersion: "0.9.0" });
    assert.ok(found.matches[0], "No compatible Neovim binary found");
    const nvimPath = found.matches[0].path;

    this.nvimProcess = child_process.spawn(nvimPath, this.argv, {
      stdio: "pipe",
    });

    this.neovimClient = attach({
      proc: this.nvimProcess,
      options: {
        logger: createNvimLogger(Boolean(options.logRpc)),
      },
    });

    this.neovimClient.on("notification", (method: string, args: unknown[]) => {
      if (method === "redraw") {
        this.applyRedrawEvents(args);
      }
    });

    this.bootPromise = this.bootstrap();
    void this.bootPromise.catch((error: unknown) => {
      renderLogger.error("Failed to bootstrap Neovim client", error);
    });
  }

  public async getValue(): Promise<string> {
    await this.bootPromise;
    const buffer = this.requireBoundBuffer();
    return this.readBufferValue(buffer);
  }

  public async setValue(text: string): Promise<void> {
    await this.bootPromise;
    const buffer = this.requireBoundBuffer();
    await this.writeBufferValue(buffer, text);
  }

  public getMode(): NvimMode {
    return this.currentVimMode;
  }

  public async showCompletion(
    items: NvimCompletionItem[],
    opts?: { startCol?: number; selected?: number },
  ): Promise<void> {
    await this.bootPromise;

    const startCol =
      typeof opts?.startCol === "number"
        ? Math.max(0, Math.floor(opts.startCol))
        : await this.getCurrentBufferColumn();

    this.lastCompletionStartCol = startCol;
    this.shownCompletionItems = [...items];
    this.popupmenuAnchor = {
      row: this.lastKnownCursor.row ?? this.cursorRow,
      col: startCol,
      grid: this.lastKnownCursor.grid ?? this.cursorGrid,
    };
    this.hideCompletionRequested = false;
    this.pendingConfirmIndex = null;

    const completeItems = items.map((item) => this.toVimCompleteItem(item));
    await this.neovimClient.call("complete", [startCol + 1, completeItems]);

    if (isFiniteNumber(opts?.selected)) {
      await this.neovimClient.selectPopupmenuItem(
        Math.floor(opts.selected),
        false,
        false,
        {},
      );
    }

    if (!this.completionEnabled) {
      const selected =
        typeof opts?.selected === "number" ? Math.floor(opts.selected) : -1;
      this.options.completion?.onShow?.({
        items: [...items],
        selected,
        anchor: { ...this.popupmenuAnchor },
      });
    }
  }

  public async updateCompletion(items: NvimCompletionItem[]): Promise<void> {
    const selected =
      this.popupmenuSelected >= 0 ? this.popupmenuSelected : undefined;
    await this.showCompletion(items, {
      startCol: this.lastCompletionStartCol,
      selected,
    });
  }

  public async hideCompletion(): Promise<void> {
    await this.bootPromise;
    this.hideCompletionRequested = true;
    this.pendingConfirmIndex = null;
    await this.neovimClient.selectPopupmenuItem(-1, false, true, {});
    if (!this.completionEnabled) {
      this.options.completion?.onHide?.();
    }
  }

  public async selectCompletion(
    index: number,
    opts?: { insert?: boolean; finish?: boolean },
  ): Promise<void> {
    await this.bootPromise;

    const normalizedIndex = Math.floor(index);
    const finish = opts?.finish === true;
    const insert = finish || opts?.insert === true;

    this.pendingConfirmIndex = finish ? normalizedIndex : null;
    await this.neovimClient.selectPopupmenuItem(
      normalizedIndex,
      insert,
      finish,
      {},
    );

    if (!this.completionEnabled) {
      const item = this.getCompletionItem(normalizedIndex);
      this.options.completion?.onSelect?.({
        index: normalizedIndex,
        item,
        anchor: { ...this.popupmenuAnchor },
        cursor: this.getCursorSnapshot(),
      });

      if (finish && item) {
        this.options.completion?.onConfirm?.({
          index: normalizedIndex,
          item,
          cursor: this.getCursorSnapshot(),
        });
      }
    }
  }

  private async bootstrap() {
    const rect = this.getContentRect();
    const cols = toNvimInt(rect.width, 1);
    const rows = toNvimInt(rect.height, 1);

    await this.neovimClient.uiAttach(cols, rows, {
      ext_linegrid: true,
      ext_multigrid: false,
      ext_cmdline: false,
      ext_popupmenu: this.completionEnabled,
      rgb: true,
    });

    await this.bindToFirstBuffer();
    await this.applyEditorOptions();
    await this.applyColorOverrides();

    if (typeof this.options.value === "string" && this.boundBuffer) {
      await this.writeBufferValue(this.boundBuffer, this.options.value);
    }

    try {
      const mode = await this.neovimClient.mode;
      if (mode && typeof mode.mode === "string") {
        this.currentVimMode = mode.mode;
      }
    } catch {
      // Ignore: mode is best-effort at bootstrap.
    }

    this.queueCursorSync();

    this.options.onReady?.();
  }

  private requireBoundBuffer(): Buffer {
    if (!this.boundBuffer) {
      throw new Error("Neovim buffer binding is not ready");
    }
    return this.boundBuffer;
  }

  private async bindToFirstBuffer() {
    const buffers = await this.neovimClient.buffers;
    const firstBuffer = buffers[0];
    if (!firstBuffer) {
      throw new Error("Neovim did not expose any buffers");
    }

    this.boundBuffer = firstBuffer;
    this.boundBufferId = firstBuffer.id;

    const stopLines = firstBuffer.listen("lines", (...eventArgs: unknown[]) => {
      void this.handleBoundBufferLines(eventArgs);
    });
    const stopChangedtick = firstBuffer.listen(
      "changedtick",
      (...eventArgs: unknown[]) => {
        void this.handleBoundBufferChangedtick(eventArgs);
      },
    );
    const stopDetach = firstBuffer.listen(
      "detach",
      (...eventArgs: unknown[]) => {
        this.handleBoundBufferDetach(eventArgs);
      },
    );

    this.boundBufferDisposers.push(
      () => {
        stopLines();
      },
      () => {
        stopChangedtick();
      },
      () => {
        stopDetach();
      },
    );
  }

  private async handleBoundBufferLines(eventArgs: unknown[]) {
    const [bufferLike, changedtick] = eventArgs;
    if (!this.isBoundBuffer(bufferLike)) return;

    if (changedtick === null) {
      return;
    }
    if (typeof changedtick === "number") {
      this.lastKnownChangedtick = changedtick;
    }

    await this.emitOnChange(this.lastKnownChangedtick);
  }

  private async handleBoundBufferChangedtick(eventArgs: unknown[]) {
    const [bufferLike, changedtick] = eventArgs;
    if (!this.isBoundBuffer(bufferLike)) return;
    if (typeof changedtick !== "number") return;

    this.lastKnownChangedtick = changedtick;
    await this.emitOnChange(changedtick);
  }

  private handleBoundBufferDetach(eventArgs: unknown[]) {
    const [bufferLike] = eventArgs;
    if (!this.isBoundBuffer(bufferLike)) return;

    renderLogger.warn(
      "Bound buffer detached; staying pinned to initial buffer id",
      this.boundBufferId,
    );
  }

  private isBoundBuffer(bufferLike: unknown): boolean {
    if (this.boundBufferId === null) return false;
    return this.extractBufferId(bufferLike) === this.boundBufferId;
  }

  private extractBufferId(bufferLike: unknown): number | null {
    if (typeof bufferLike === "number") return bufferLike;
    if (!bufferLike || typeof bufferLike !== "object") return null;

    const candidateId = (bufferLike as { id?: unknown }).id;
    if (typeof candidateId === "number") return candidateId;

    const candidateData = (bufferLike as { data?: unknown }).data;
    if (typeof candidateData === "number") return candidateData;

    return null;
  }

  private async emitOnChange(changedtick?: number) {
    if (!this.options.onChange || !this.boundBuffer) return;

    try {
      const value = await this.readBufferValue(this.boundBuffer);
      this.options.onChange({
        value,
        changedtick,
        cursor: this.getCursorSnapshot(),
        mode: this.currentVimMode,
      });
    } catch (error) {
      renderLogger.error("Failed to emit onChange callback", error);
    }
  }

  private async readBufferValue(buffer: Buffer): Promise<string> {
    const lines = await buffer.lines;
    return lines.join("\n");
  }

  private async writeBufferValue(buffer: Buffer, text: string): Promise<void> {
    const lines = toBufferLines(text);
    await buffer.setLines(lines, {
      start: 0,
      end: -1,
      strictIndexing: false,
    });
  }

  private async applyEditorOptions() {
    const commands: string[] = [];

    switch (this.options.wrapMode) {
      case "none":
        commands.push("setlocal nowrap nolinebreak");
        break;
      case "char":
        commands.push("setlocal wrap nolinebreak");
        break;
      case "word":
        commands.push("setlocal wrap linebreak");
        break;
      default:
        break;
    }

    if (isFiniteNumber(this.options.tabSize)) {
      const tabSize = Math.max(1, Math.floor(this.options.tabSize));
      commands.push(`setlocal tabstop=${tabSize}`);
      commands.push(`setlocal shiftwidth=${tabSize}`);
      commands.push(`setlocal softtabstop=${tabSize}`);
    }

    const lineNumbers = this.options.lineNumbers;
    if (typeof lineNumbers === "boolean") {
      if (lineNumbers) {
        commands.push("setlocal number norelativenumber");
      } else {
        commands.push("setlocal nonumber norelativenumber");
      }
    } else if (lineNumbers) {
      const relative = lineNumbers.relative === true;
      const current = lineNumbers.current !== false;
      const numberFlag = current ? "number" : "nonumber";
      const relativeFlag = relative ? "relativenumber" : "norelativenumber";
      commands.push(`setlocal ${numberFlag} ${relativeFlag}`);

      if (isFiniteNumber(lineNumbers.width)) {
        const width = Math.max(1, Math.floor(lineNumbers.width));
        commands.push(`setlocal numberwidth=${width}`);
      }
    }

    for (const command of commands) {
      try {
        await this.neovimClient.command(command);
      } catch (error) {
        renderLogger.warn("Failed to apply Neovim option", { command, error });
      }
    }
  }

  private async applyColorOverrides() {
    await this.applyHighlightOverride("Normal", {
      fg: this.options.textColor,
    });
    await this.applyHighlightOverride("Visual", {
      fg: this.options.selectionFg,
      bg: this.options.selectionBg,
    });
    await this.applyHighlightOverride("Cursor", {
      bg: this.options.cursorColor,
    });
    await this.applyHighlightOverride("LineNr", {
      fg: this.options.lineNumberFg,
      bg: this.options.lineNumberBg,
    });
    await this.applyHighlightOverride("CursorLineNr", {
      fg: this.options.lineNumberFg,
      bg: this.options.lineNumberBg,
    });
  }

  private async applyHighlightOverride(
    group: string,
    colors: { fg?: ColorInput; bg?: ColorInput },
  ) {
    const fg = toNvimHex(colors.fg);
    const bg = toNvimHex(colors.bg);
    const attrs: string[] = [];
    if (fg) attrs.push(`guifg=${fg}`);
    if (bg) attrs.push(`guibg=${bg}`);
    if (attrs.length === 0) return;

    try {
      await this.neovimClient.command(`highlight ${group} ${attrs.join(" ")}`);
    } catch (error) {
      renderLogger.warn("Failed to apply highlight override", {
        group,
        error,
      });
    }
  }

  private getCursorSnapshot(): NvimPosition {
    return {
      line: this.lastKnownCursor.line,
      col: this.lastKnownCursor.col,
      row: this.lastKnownCursor.row,
      grid: this.lastKnownCursor.grid,
    };
  }

  private queueCursorSync(row?: number, col?: number, grid?: number) {
    this.cursorSyncPending = {
      row: isFiniteNumber(row)
        ? row
        : (this.lastKnownCursor.row ?? this.cursorRow),
      col: isFiniteNumber(col)
        ? col
        : (this.lastKnownCursor.col ?? this.cursorCol),
      grid: isFiniteNumber(grid)
        ? grid
        : (this.lastKnownCursor.grid ?? this.cursorGrid),
    };

    if (this.cursorSyncInFlight) return;
    this.cursorSyncInFlight = true;
    void this.flushCursorSync();
  }

  private async flushCursorSync() {
    while (this.cursorSyncPending) {
      const pending = this.cursorSyncPending;
      this.cursorSyncPending = null;

      try {
        const window = await this.neovimClient.window;
        const [line, col] = await window.cursor;
        this.lastKnownCursor = {
          line: Math.max(0, line - 1),
          col: Math.max(0, col),
          row: pending.row,
          grid: pending.grid,
        };
        this.options.onCursorChange?.({
          cursor: this.getCursorSnapshot(),
          mode: this.currentVimMode,
        });
      } catch {
        // Keep redraw-derived cursor if RPC cursor lookup fails.
      }
    }

    this.cursorSyncInFlight = false;
  }

  private async getCurrentBufferColumn(): Promise<number> {
    try {
      const window = await this.neovimClient.window;
      const [, col] = await window.cursor;
      return Math.max(0, col);
    } catch {
      return Math.max(0, this.lastKnownCursor.col);
    }
  }

  private toVimCompleteItem(item: NvimCompletionItem): Record<string, unknown> {
    const payload: Record<string, unknown> = {
      word: item.word,
    };

    if (item.abbr !== undefined) payload.abbr = item.abbr;
    if (item.kind !== undefined) payload.kind = item.kind;
    if (item.menu !== undefined) payload.menu = item.menu;
    if (item.info !== undefined) payload.info = item.info;

    if (item.data !== undefined) {
      try {
        payload.user_data = JSON.stringify(item.data);
      } catch {
        // Best-effort only.
      }
    }

    return payload;
  }

  private normalizePopupmenuItem(
    raw: unknown,
    index: number,
  ): NvimCompletionItem {
    const fallback = this.shownCompletionItems[index];

    if (Array.isArray(raw)) {
      const [abbrRaw, kindRaw, menuRaw, infoRaw] = raw;
      const abbr = typeof abbrRaw === "string" ? abbrRaw : undefined;
      const kind = typeof kindRaw === "string" ? kindRaw : undefined;
      const menu = typeof menuRaw === "string" ? menuRaw : undefined;
      const info = typeof infoRaw === "string" ? infoRaw : undefined;

      return {
        word: fallback?.word ?? abbr ?? "",
        abbr: fallback?.abbr ?? abbr,
        kind: fallback?.kind ?? kind,
        menu: fallback?.menu ?? menu,
        info: fallback?.info ?? info,
        data: fallback?.data,
      };
    }

    if (raw && typeof raw === "object") {
      const rawRecord = raw as Record<string, unknown>;
      const word =
        typeof rawRecord.word === "string"
          ? rawRecord.word
          : (fallback?.word ?? "");
      return {
        word,
        abbr:
          typeof rawRecord.abbr === "string" ? rawRecord.abbr : fallback?.abbr,
        kind:
          typeof rawRecord.kind === "string" ? rawRecord.kind : fallback?.kind,
        menu:
          typeof rawRecord.menu === "string" ? rawRecord.menu : fallback?.menu,
        info:
          typeof rawRecord.info === "string" ? rawRecord.info : fallback?.info,
        data: fallback?.data,
      };
    }

    return {
      word: fallback?.word ?? "",
      abbr: fallback?.abbr,
      kind: fallback?.kind,
      menu: fallback?.menu,
      info: fallback?.info,
      data: fallback?.data,
    };
  }

  private getCompletionItem(index: number): NvimCompletionItem | null {
    if (index < 0) return null;
    return (
      this.popupmenuItems[index] ?? this.shownCompletionItems[index] ?? null
    );
  }

  private emitCompletionSelect(index: number) {
    const callback = this.options.completion?.onSelect;
    if (!callback) return;

    callback({
      index,
      item: this.getCompletionItem(index),
      anchor: { ...this.popupmenuAnchor },
      cursor: this.getCursorSnapshot(),
    });
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
      const repeat = typeof rawCell[2] === "number" ? rawCell[2] : 1;
      const chars = Array.from(text);

      for (let rep = 0; rep < repeat; rep++) {
        for (const ch of chars) {
          if (col >= this.gridW) break;
          if (col >= 0) {
            const idx = row * this.gridW + col;
            const cell = this.grid[idx];
            if (cell) {
              cell.ch = ch.length === 0 ? " " : ch;
              cell.hl = currentHl;
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

      switch (name) {
        case "default_colors_set": {
          for (const call of args) {
            if (!Array.isArray(call) || call.length < 2) continue;
            const fg = call[0];
            const bg = call[1];
            if (typeof fg === "number") this.defaultFg = nvimRgbToRgba(fg);
            if (typeof bg === "number") this.defaultBg = nvimRgbToRgba(bg);
          }
          this.requestRender();
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
            ) {
              continue;
            }

            this.hl.set(id, this.parseHl(rgbAttrs));
          }
          break;
        }
        case "grid_resize": {
          for (const call of args) {
            if (!Array.isArray(call) || call.length < 3) continue;
            const [, w, h] = call as [number, number, number];
            if (typeof w === "number" && typeof h === "number") {
              this.resizeGrid(w, h);
            }
          }
          this.requestRender();
          break;
        }
        case "grid_clear": {
          for (const call of args) {
            if (!Array.isArray(call) || call.length < 1) continue;
            this.clearGrid();
          }
          this.requestRender();
          break;
        }
        case "grid_cursor_goto": {
          for (const call of args) {
            if (!Array.isArray(call) || call.length < 3) continue;
            const [grid, row, col] = call as [number, number, number];
            if (typeof row !== "number" || typeof col !== "number") continue;

            this.cursorRow = row;
            this.cursorCol = col;
            if (typeof grid === "number") {
              this.cursorGrid = grid;
            }

            this.lastKnownCursor = {
              line: row,
              col,
              row,
              grid: this.cursorGrid,
            };

            if (this.focused) {
              const x = this.x + col;
              const y = this.y + row;
              this.ctx.setCursorPosition(x + 1, y + 1, true);

              const cursorStyle = this.getCursorStyleForMode();
              this.ctx.setCursorStyle(cursorStyle, false);
            } else {
              this.ctx.setCursorPosition(1, 1, false);
            }

            this.options.onCursorChange?.({
              cursor: this.getCursorSnapshot(),
              mode: this.currentVimMode,
            });

            this.queueCursorSync(row, col, this.cursorGrid);
          }
          this.requestRender();
          break;
        }
        case "grid_scroll": {
          for (const call of args) {
            if (!Array.isArray(call) || call.length < 7) continue;
            const [, top, bot, left, right, rows, cols] = call as [
              number,
              number,
              number,
              number,
              number,
              number,
              number,
            ];
            this.scrollGrid(top, bot, left, right, rows, cols);
          }
          this.requestRender();
          break;
        }
        case "grid_line": {
          for (const call of args) {
            if (!Array.isArray(call) || call.length < 4) continue;
            const [, row, colStart, cells] = call as [
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
          }
          this.requestRender();
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
            const previousMode = this.currentVimMode;
            if (typeof modeName === "string") {
              this.currentVimMode = modeName;
            }
            const cursorStyle = this.getCursorStyleForMode();
            this.ctx.setCursorStyle(cursorStyle, false);

            if (previousMode !== this.currentVimMode) {
              this.options.onModeChange?.({
                mode: this.currentVimMode,
                previousMode,
                cursorShape: cursorStyle,
              });
            }

            this.options.onCursorChange?.({
              cursor: this.getCursorSnapshot(),
              mode: this.currentVimMode,
            });
          }
          break;
        }
        case "popupmenu_show": {
          for (const call of args) {
            if (!Array.isArray(call) || call.length < 5) continue;
            const [items, selected, row, col, grid] = call as [
              unknown[],
              number,
              number,
              number,
              number,
            ];

            this.popupmenuVisible = true;
            this.popupmenuSelected =
              typeof selected === "number" ? selected : -1;
            this.popupmenuAnchor = {
              row: typeof row === "number" ? row : 0,
              col: typeof col === "number" ? col : 0,
              grid: typeof grid === "number" ? grid : 0,
            };
            this.popupmenuItems = Array.isArray(items)
              ? items.map((item, index) =>
                  this.normalizePopupmenuItem(item, index),
                )
              : [];
            this.hideCompletionRequested = false;
            this.pendingConfirmIndex = null;

            if (this.completionEnabled) {
              this.options.completion?.onShow?.({
                items: [...this.popupmenuItems],
                selected: this.popupmenuSelected,
                anchor: { ...this.popupmenuAnchor },
              });
              if (this.popupmenuSelected >= 0) {
                this.emitCompletionSelect(this.popupmenuSelected);
              }
            }
          }
          break;
        }
        case "popupmenu_select": {
          for (const call of args) {
            if (!Array.isArray(call) || call.length < 1) continue;
            const [selected] = call as [number];
            this.popupmenuSelected =
              typeof selected === "number" ? selected : -1;
            if (this.completionEnabled) {
              this.emitCompletionSelect(this.popupmenuSelected);
            }
          }
          break;
        }
        case "popupmenu_hide": {
          const confirmIndex =
            this.pendingConfirmIndex ?? this.popupmenuSelected;
          const confirmItem = this.getCompletionItem(confirmIndex);
          const shouldEmitConfirm =
            this.completionEnabled &&
            !this.hideCompletionRequested &&
            confirmIndex >= 0 &&
            !!confirmItem;

          this.popupmenuVisible = false;
          this.popupmenuSelected = -1;
          this.popupmenuItems = [];
          this.pendingConfirmIndex = null;
          this.hideCompletionRequested = false;

          if (shouldEmitConfirm && confirmItem) {
            this.options.completion?.onConfirm?.({
              index: confirmIndex,
              item: confirmItem,
              cursor: this.getCursorSnapshot(),
            });
          }

          if (this.completionEnabled) {
            this.options.completion?.onHide?.();
          }
          break;
        }
        case "flush": {
          break;
        }
        default: {
          break;
        }
      }
    }
  }

  private getCursorStyleForMode(): CursorShape {
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
    const cols = toNvimInt(rect.width, 1);
    const rows = toNvimInt(rect.height, 1);

    try {
      await this.bootPromise;
      await this.neovimClient.uiTryResize(cols, rows);
    } catch {
      // Ignore resize races during startup/shutdown.
    }
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
    void this.neovimClient.input(input);
    key.preventDefault();
    return true;
  }

  protected override renderSelf(buffer: OptimizedBuffer) {
    const rect = this.getContentRect();

    if (this.gridW === 0 || this.gridH === 0) {
      buffer.drawText(
        "Neovim attached, waiting for redraw...",
        rect.x,
        rect.y,
        RGBA.fromInts(255, 255, 255, 255),
        RGBA.fromInts(0, 0, 0, 255),
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

  protected override destroySelf(): void {
    void this.shutdown();
    super.destroySelf();
  }

  private async shutdown() {
    if (this.shuttingDown) return;
    this.shuttingDown = true;

    for (const dispose of this.boundBufferDisposers.splice(0)) {
      try {
        dispose();
      } catch {
        // Ignore disposer failures during shutdown.
      }
    }

    try {
      await this.neovimClient.uiDetach();
    } catch {
      // Ignore if UI was never attached.
    }

    try {
      this.neovimClient.quit();
    } catch {
      // Ignore if transport already closed.
    }

    try {
      await this.neovimClient.close();
    } catch {
      // Ignore close errors.
    }

    if (!this.nvimProcess.killed) {
      this.nvimProcess.kill();
    }
  }
}
