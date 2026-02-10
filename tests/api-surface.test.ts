import { test, expect } from "bun:test";
import * as fs from "node:fs";
import * as path from "node:path";
import { spawn } from "node:child_process";

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

type HarnessSession = {
  name: string;
  commandsFile: string;
  resultsFile: string;
  eventsFile: string;
  commandSeq: number;
};

type HarnessEvent = {
  type: string;
  timestamp: string;
  [key: string]: unknown;
};

type HarnessResult = {
  id: string;
  ok: boolean;
  timestamp: string;
  value?: unknown;
  error?: string;
};

const projectRoot = path.resolve(import.meta.dir, "..");

function stripAnsi(value: string): string {
  return value.replace(/\u001b\[[0-9;]*m/g, "");
}

function parseJsonFromOutput(raw: string): unknown {
  const cleaned = stripAnsi(raw).trim();
  const start = cleaned.indexOf("{");
  const end = cleaned.lastIndexOf("}");

  if (start < 0 || end < start) {
    throw new Error(`No JSON object found in output:\n${cleaned}`);
  }

  return JSON.parse(cleaned.slice(start, end + 1));
}

async function runProcess(
  command: string,
  args: string[],
  timeoutMs = 30_000,
): Promise<string> {
  return await new Promise<string>((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: projectRoot,
      env: process.env,
      stdio: ["ignore", "pipe", "pipe"],
    });

    let stdout = "";
    let stderr = "";

    const timeout = setTimeout(() => {
      child.kill("SIGTERM");
      reject(
        new Error(
          `Command timed out: ${command} ${args.join(" ")}\nstdout:\n${stdout}\nstderr:\n${stderr}`,
        ),
      );
    }, timeoutMs);

    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");

    child.stdout.on("data", (chunk: string) => {
      stdout += chunk;
    });

    child.stderr.on("data", (chunk: string) => {
      stderr += chunk;
    });

    child.on("error", (error) => {
      clearTimeout(timeout);
      reject(error);
    });

    child.on("close", (code) => {
      clearTimeout(timeout);
      if (code === 0) {
        resolve(stdout);
        return;
      }
      reject(
        new Error(
          `Command failed (${code}): ${command} ${args.join(" ")}\nstdout:\n${stdout}\nstderr:\n${stderr}`,
        ),
      );
    });
  });
}

async function pilottyRaw(args: string[], timeoutMs?: number): Promise<string> {
  return await runProcess("bunx", ["pilotty", ...args], timeoutMs);
}

async function pilottyJson(
  args: string[],
  timeoutMs?: number,
): Promise<Record<string, unknown>> {
  const output = await pilottyRaw(args, timeoutMs);
  return parseJsonFromOutput(output) as Record<string, unknown>;
}

function readNdjson<T>(filePath: string): T[] {
  if (!fs.existsSync(filePath)) {
    return [];
  }

  const raw = fs.readFileSync(filePath, "utf8");
  if (!raw.trim()) {
    return [];
  }

  const values: T[] = [];
  for (const line of raw.split(/\r?\n/)) {
    if (!line.trim()) continue;
    try {
      values.push(JSON.parse(line) as T);
    } catch {
      // Ignore partially-written lines while polling.
    }
  }

  return values;
}

function createSessionName(prefix: string): string {
  const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  return `${prefix}-${suffix}`;
}

async function startHarness(
  options: HarnessOptions = {},
): Promise<HarnessSession> {
  const name = createSessionName("nvim-api");
  const artifactsDir = path.join(projectRoot, "logs", "test-artifacts", name);
  fs.mkdirSync(artifactsDir, { recursive: true });

  const commandsFile = path.join(artifactsDir, "commands.ndjson");
  const resultsFile = path.join(artifactsDir, "results.ndjson");
  const eventsFile = path.join(artifactsDir, "events.ndjson");
  const configFile = path.join(artifactsDir, "config.json");

  fs.writeFileSync(commandsFile, "", "utf8");
  fs.writeFileSync(resultsFile, "", "utf8");
  fs.writeFileSync(eventsFile, "", "utf8");

  fs.writeFileSync(
    configFile,
    JSON.stringify(
      {
        commandsFile,
        resultsFile,
        eventsFile,
        pollIntervalMs: 20,
        options,
      },
      null,
      2,
    ),
    "utf8",
  );

  await pilottyJson(
    [
      "spawn",
      "--name",
      name,
      "--cwd",
      projectRoot,
      "bun",
      "tests/pilotty/harness.ts",
      "--config",
      configFile,
    ],
    60_000,
  );

  const session: HarnessSession = {
    name,
    commandsFile,
    resultsFile,
    eventsFile,
    commandSeq: 0,
  };

  await waitForEvent(session, (event) => event.type === "ready", {
    timeoutMs: 20_000,
    label: "ready event",
  });

  return session;
}

async function stopHarness(session: HarnessSession): Promise<void> {
  try {
    await pilottyJson(["kill", "-s", session.name], 10_000);
  } catch {
    // Ignore if session already exited.
  }
}

function readEvents(session: HarnessSession): HarnessEvent[] {
  return readNdjson<HarnessEvent>(session.eventsFile);
}

function readResults(session: HarnessSession): HarnessResult[] {
  return readNdjson<HarnessResult>(session.resultsFile);
}

async function waitForEvent(
  session: HarnessSession,
  predicate: (event: HarnessEvent) => boolean,
  opts?: {
    timeoutMs?: number;
    startIndex?: number;
    label?: string;
  },
): Promise<HarnessEvent> {
  const timeoutMs = opts?.timeoutMs ?? 10_000;
  const startIndex = opts?.startIndex ?? 0;
  const label = opts?.label ?? "event";
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    const events = readEvents(session);
    for (let index = startIndex; index < events.length; index += 1) {
      const event = events[index];
      if (event && predicate(event)) {
        return event;
      }
    }
    await Bun.sleep(25);
  }

  const events = readEvents(session);
  throw new Error(
    `Timed out waiting for ${label}. Latest events:\n${JSON.stringify(events.slice(-20), null, 2)}`,
  );
}

async function sendHarnessCommand<T = unknown>(
  session: HarnessSession,
  action: string,
  payload?: unknown,
  timeoutMs = 10_000,
): Promise<T> {
  session.commandSeq += 1;
  const id = `cmd-${session.commandSeq}`;

  fs.appendFileSync(
    session.commandsFile,
    `${JSON.stringify({ id, action, payload })}\n`,
    "utf8",
  );

  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    const results = readResults(session);
    const matched = results.find((result) => result.id === id);
    if (matched) {
      if (!matched.ok) {
        throw new Error(`Harness command ${action} failed: ${matched.error}`);
      }
      return matched.value as T;
    }
    await Bun.sleep(25);
  }

  throw new Error(`Timed out waiting for result of command ${action}`);
}

async function sendKey(session: HarnessSession, key: string): Promise<void> {
  await pilottyJson(["key", "-s", session.name, key], 10_000);
}

async function sendText(session: HarnessSession, text: string): Promise<void> {
  await pilottyJson(["type", "-s", session.name, text], 10_000);
}

async function resizeSession(
  session: HarnessSession,
  cols: number,
  rows: number,
): Promise<void> {
  await pilottyJson(
    ["resize", "-s", session.name, String(cols), String(rows)],
    10_000,
  );
}

async function snapshotText(session: HarnessSession): Promise<string> {
  return await pilottyRaw(
    ["snapshot", "-s", session.name, "--format", "text"],
    10_000,
  );
}

async function withHarness(
  options: HarnessOptions,
  runScenario: (session: HarnessSession) => Promise<void>,
): Promise<void> {
  const session = await startHarness(options);
  try {
    await runScenario(session);
  } finally {
    await stopHarness(session);
  }
}

function asRecord(value: unknown): Record<string, unknown> {
  if (value && typeof value === "object") {
    return value as Record<string, unknown>;
  }
  return {};
}

function toBooleanOption(value: unknown): boolean {
  if (typeof value === "boolean") return value;
  if (typeof value === "number") return value !== 0;
  if (typeof value === "string") {
    return ["1", "true", "on", "yes"].includes(value.toLowerCase());
  }
  return Boolean(value);
}

function toNumberOption(value: unknown): number {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  const converted = Number(value);
  if (Number.isFinite(converted)) {
    return converted;
  }
  throw new Error(`Cannot coerce value to number: ${String(value)}`);
}

function hexToNvimColor(hex: string): number {
  const normalized = hex.replace(/^#/, "");
  if (!/^[0-9a-fA-F]{6}$/.test(normalized)) {
    throw new Error(`Expected RGB hex color, received: ${hex}`);
  }
  return Number.parseInt(normalized, 16);
}

function pickColor(map: unknown, ...keys: string[]): number | undefined {
  const record = asRecord(map);
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "number" && Number.isFinite(value)) {
      return value;
    }
  }
  return undefined;
}

test("covers NvimRenderable API surface with pilotty", async () => {
  await withHarness(
    {
      value: "seed-value",
      logRpc: true,
    },
    async (session) => {
      const events = readEvents(session);
      expect(events.filter((event) => event.type === "ready")).toHaveLength(1);

      const childInfo = await sendHarnessCommand<{
        pid: number | null;
        spawnargs: string[];
      }>(session, "debugNvimChild");
      expect(childInfo.pid).toBeGreaterThan(0);
      expect(childInfo.spawnargs).toContain("--clean");
      expect(childInfo.spawnargs).toContain("--headless");
      expect(childInfo.spawnargs).toContain("--embed");

      const initialValue = await sendHarnessCommand<string>(
        session,
        "getValue",
      );
      expect(initialValue).toBe("seed-value");

      await sendHarnessCommand(session, "setValue", {
        text: "line-one\nline-two",
      });
      const updatedValue = await sendHarnessCommand<string>(
        session,
        "getValue",
      );
      expect(updatedValue).toBe("line-one\nline-two");

      const mode = await sendHarnessCommand<string>(session, "getMode");
      expect(typeof mode).toBe("string");
      expect(mode.length).toBeGreaterThan(0);

      const changeEvent = await waitForEvent(
        session,
        (event) => event.type === "change",
        { timeoutMs: 15_000, label: "change event" },
      );
      const changePayload = asRecord(changeEvent);
      expect(typeof changePayload.value).toBe("string");
      expect(typeof changePayload.mode).toBe("string");
      expect(typeof changePayload.cursor).toBe("object");
    },
  );

  await withHarness(
    {
      argv: ["--headless", "--embed"],
    },
    async (session) => {
      const childInfo = await sendHarnessCommand<{
        pid: number | null;
        spawnargs: string[];
      }>(session, "debugNvimChild");
      expect(childInfo.spawnargs).not.toContain("--clean");
      expect(childInfo.spawnargs).toContain("--headless");
      expect(childInfo.spawnargs).toContain("--embed");
    },
  );

  await withHarness(
    {
      wrapMode: "word",
      tabSize: 4,
      lineNumbers: {
        relative: true,
        current: true,
        width: 6,
      },
      textColor: "#112233",
      selectionFg: "#223344",
      selectionBg: "#334455",
      cursorColor: "#aa0011",
      lineNumberFg: "#00aa22",
      lineNumberBg: "#001122",
    },
    async (session) => {
      const wrap = await sendHarnessCommand(session, "debugGetOption", {
        scope: "window",
        name: "wrap",
      });
      const linebreak = await sendHarnessCommand(session, "debugGetOption", {
        scope: "window",
        name: "linebreak",
      });
      expect(toBooleanOption(wrap)).toBe(true);
      expect(toBooleanOption(linebreak)).toBe(true);

      const tabstop = await sendHarnessCommand(session, "debugGetOption", {
        scope: "buffer",
        name: "tabstop",
      });
      const shiftwidth = await sendHarnessCommand(session, "debugGetOption", {
        scope: "buffer",
        name: "shiftwidth",
      });
      const softtabstop = await sendHarnessCommand(session, "debugGetOption", {
        scope: "buffer",
        name: "softtabstop",
      });
      expect(toNumberOption(tabstop)).toBe(4);
      expect(toNumberOption(shiftwidth)).toBe(4);
      expect(toNumberOption(softtabstop)).toBe(4);

      const number = await sendHarnessCommand(session, "debugGetOption", {
        scope: "window",
        name: "number",
      });
      const relative = await sendHarnessCommand(session, "debugGetOption", {
        scope: "window",
        name: "relativenumber",
      });
      const numberwidth = await sendHarnessCommand(session, "debugGetOption", {
        scope: "window",
        name: "numberwidth",
      });
      expect(toBooleanOption(number)).toBe(true);
      expect(toBooleanOption(relative)).toBe(true);
      expect(toNumberOption(numberwidth)).toBe(6);

      const normalHighlight = await sendHarnessCommand(
        session,
        "debugHighlight",
        {
          name: "Normal",
        },
      );
      const visualHighlight = await sendHarnessCommand(
        session,
        "debugHighlight",
        {
          name: "Visual",
        },
      );
      const cursorHighlight = await sendHarnessCommand(
        session,
        "debugHighlight",
        {
          name: "Cursor",
        },
      );
      const lineNrHighlight = await sendHarnessCommand(
        session,
        "debugHighlight",
        {
          name: "LineNr",
        },
      );

      expect(pickColor(normalHighlight, "fg", "foreground")).toBe(
        hexToNvimColor("#112233"),
      );
      expect(pickColor(visualHighlight, "fg", "foreground")).toBe(
        hexToNvimColor("#223344"),
      );
      expect(pickColor(visualHighlight, "bg", "background")).toBe(
        hexToNvimColor("#334455"),
      );
      expect(pickColor(cursorHighlight, "bg", "background")).toBe(
        hexToNvimColor("#aa0011"),
      );
      expect(pickColor(lineNrHighlight, "fg", "foreground")).toBe(
        hexToNvimColor("#00aa22"),
      );
      expect(pickColor(lineNrHighlight, "bg", "background")).toBe(
        hexToNvimColor("#001122"),
      );
    },
  );

  await withHarness(
    {
      lineNumbers: false,
    },
    async (session) => {
      const number = await sendHarnessCommand(session, "debugGetOption", {
        scope: "window",
        name: "number",
      });
      const relative = await sendHarnessCommand(session, "debugGetOption", {
        scope: "window",
        name: "relativenumber",
      });
      expect(toBooleanOption(number)).toBe(false);
      expect(toBooleanOption(relative)).toBe(false);
    },
  );

  await withHarness(
    {
      lineNumbers: true,
    },
    async (session) => {
      const number = await sendHarnessCommand(session, "debugGetOption", {
        scope: "window",
        name: "number",
      });
      const relative = await sendHarnessCommand(session, "debugGetOption", {
        scope: "window",
        name: "relativenumber",
      });
      expect(toBooleanOption(number)).toBe(true);
      expect(toBooleanOption(relative)).toBe(false);
    },
  );

  await withHarness(
    {
      lineNumbers: {
        relative: true,
        current: false,
        width: "auto",
      },
    },
    async (session) => {
      const number = await sendHarnessCommand(session, "debugGetOption", {
        scope: "window",
        name: "number",
      });
      const relative = await sendHarnessCommand(session, "debugGetOption", {
        scope: "window",
        name: "relativenumber",
      });
      const numberwidth = await sendHarnessCommand(session, "debugGetOption", {
        scope: "window",
        name: "numberwidth",
      });
      expect(toBooleanOption(number)).toBe(false);
      expect(toBooleanOption(relative)).toBe(true);
      expect(toNumberOption(numberwidth)).toBeGreaterThan(0);
    },
  );

  for (const scenario of [
    { wrapMode: "none" as const, wrap: false, linebreak: false },
    { wrapMode: "char" as const, wrap: true, linebreak: false },
  ]) {
    await withHarness(
      {
        wrapMode: scenario.wrapMode,
      },
      async (session) => {
        const wrap = await sendHarnessCommand(session, "debugGetOption", {
          scope: "window",
          name: "wrap",
        });
        const linebreak = await sendHarnessCommand(session, "debugGetOption", {
          scope: "window",
          name: "linebreak",
        });
        expect(toBooleanOption(wrap)).toBe(scenario.wrap);
        expect(toBooleanOption(linebreak)).toBe(scenario.linebreak);
      },
    );
  }

  await withHarness({}, async (session) => {
    await sendHarnessCommand(session, "focus");

    const startIndex = readEvents(session).length;
    await sendKey(session, "i");
    await waitForEvent(
      session,
      (event) => event.type === "mode_change" && event.mode === "insert",
      { startIndex, timeoutMs: 10_000, label: "insert mode event" },
    );

    await sendText(session, "alpha");
    await sendKey(session, "Ctrl+o");
    await sendText(session, ":enew");
    await sendKey(session, "Enter");
    await sendText(session, "beta");
    await sendKey(session, "Ctrl+o");
    await sendText(session, ":buffer 1");
    await sendKey(session, "Enter");
    await sendText(session, "omega");

    await Bun.sleep(400);

    const events = readEvents(session).slice(startIndex);
    const modeEvents = events.filter((event) => event.type === "mode_change");
    const cursorEvents = events.filter(
      (event) => event.type === "cursor_change",
    );
    const changeEvents = events.filter((event) => event.type === "change");

    expect(modeEvents.length).toBeGreaterThan(0);
    expect(modeEvents.some((event) => event.mode === "insert")).toBe(true);

    expect(cursorEvents.length).toBeGreaterThan(0);
    const sampleCursorEvent = asRecord(cursorEvents[0]);
    const cursor = asRecord(sampleCursorEvent.cursor);
    expect(typeof cursor.line).toBe("number");
    expect(typeof cursor.col).toBe("number");

    const values = changeEvents
      .map((event) => asRecord(event).value)
      .filter((value): value is string => typeof value === "string");
    expect(values.some((value) => value.includes("alpha"))).toBe(true);
    expect(values.some((value) => value.includes("alphaomega"))).toBe(true);
    expect(values.some((value) => value.includes("beta"))).toBe(false);

    const bufferIds = await sendHarnessCommand<number[]>(
      session,
      "debugListBufferIds",
    );
    expect(bufferIds.length).toBeGreaterThanOrEqual(2);

    const boundId = await sendHarnessCommand<number | null>(
      session,
      "debugGetBoundBufferId",
    );
    expect(boundId).toBeGreaterThan(0);
  });

  await withHarness(
    {
      completion: {
        enabled: false,
      },
    },
    async (session) => {
      await sendHarnessCommand(session, "focus");
      const modeIndex = readEvents(session).length;
      await sendKey(session, "i");
      await waitForEvent(
        session,
        (event) => event.type === "mode_change" && event.mode === "insert",
        { startIndex: modeIndex, timeoutMs: 10_000, label: "insert mode" },
      );

      const showStart = readEvents(session).length;
      await sendHarnessCommand(session, "showCompletion", {
        items: [
          { word: "first-item", menu: "test" },
          { word: "second-item", menu: "test" },
        ],
        opts: {
          startCol: 0,
          selected: 0,
        },
      });
      const firstShow = await waitForEvent(
        session,
        (event) => event.type === "completion_show",
        { startIndex: showStart, timeoutMs: 10_000, label: "completion show" },
      );
      const firstShowItems = asRecord(firstShow).items as unknown[];
      expect(Array.isArray(firstShowItems)).toBe(true);
      expect(firstShowItems.length).toBe(2);

      const secondShowStart = readEvents(session).length;
      await sendHarnessCommand(session, "updateCompletion", {
        items: [
          { word: "updated-one", menu: "test" },
          { word: "updated-two", menu: "test" },
        ],
      });
      await waitForEvent(
        session,
        (event) =>
          event.type === "completion_show" &&
          JSON.stringify(asRecord(event).items).includes("updated-two"),
        {
          startIndex: secondShowStart,
          timeoutMs: 10_000,
          label: "updated completion show",
        },
      );

      const selectStart = readEvents(session).length;
      await sendHarnessCommand(session, "selectCompletion", {
        index: 1,
        opts: {
          insert: false,
          finish: false,
        },
      });
      await waitForEvent(
        session,
        (event) => event.type === "completion_select" && event.index === 1,
        {
          startIndex: selectStart,
          timeoutMs: 10_000,
          label: "completion select",
        },
      );

      const confirmStart = readEvents(session).length;
      await sendHarnessCommand(session, "selectCompletion", {
        index: 1,
        opts: {
          finish: true,
        },
      });
      await waitForEvent(
        session,
        (event) => event.type === "completion_confirm" && event.index === 1,
        {
          startIndex: confirmStart,
          timeoutMs: 10_000,
          label: "completion confirm",
        },
      );

      const hideStart = readEvents(session).length;
      await sendHarnessCommand(session, "hideCompletion");
      await waitForEvent(session, (event) => event.type === "completion_hide", {
        startIndex: hideStart,
        timeoutMs: 10_000,
        label: "completion hide",
      });
    },
  );

  await withHarness(
    {
      completion: {
        enabled: true,
      },
    },
    async (session) => {
      await sendHarnessCommand(session, "focus");
      const modeStart = readEvents(session).length;
      await sendKey(session, "i");
      await waitForEvent(
        session,
        (event) => event.type === "mode_change" && event.mode === "insert",
        { startIndex: modeStart, timeoutMs: 10_000, label: "insert mode" },
      );

      const showStart = readEvents(session).length;
      await sendHarnessCommand(session, "showCompletion", {
        items: [{ word: "alpha" }, { word: "beta" }],
        opts: {
          startCol: 0,
          selected: 0,
        },
      });
      await waitForEvent(session, (event) => event.type === "completion_show", {
        startIndex: showStart,
        timeoutMs: 10_000,
        label: "completion show",
      });

      const selectStart = readEvents(session).length;
      await sendHarnessCommand(session, "selectCompletion", {
        index: 1,
        opts: {
          insert: false,
          finish: false,
        },
      });
      await waitForEvent(
        session,
        (event) => event.type === "completion_select" && event.index === 1,
        {
          startIndex: selectStart,
          timeoutMs: 10_000,
          label: "completion select",
        },
      );

      const confirmStart = readEvents(session).length;
      await sendHarnessCommand(session, "selectCompletion", {
        index: 1,
        opts: {
          finish: true,
        },
      });
      await waitForEvent(
        session,
        (event) => event.type === "completion_confirm" && event.index === 1,
        {
          startIndex: confirmStart,
          timeoutMs: 10_000,
          label: "completion confirm",
        },
      );
      await waitForEvent(session, (event) => event.type === "completion_hide", {
        startIndex: confirmStart,
        timeoutMs: 10_000,
        label: "completion hide",
      });

      const secondShowStart = readEvents(session).length;
      await sendHarnessCommand(session, "showCompletion", {
        items: [{ word: "gamma" }, { word: "delta" }],
        opts: {
          startCol: 0,
          selected: 0,
        },
      });
      await waitForEvent(session, (event) => event.type === "completion_show", {
        startIndex: secondShowStart,
        timeoutMs: 10_000,
        label: "second completion show",
      });

      const hideStart = readEvents(session).length;
      await sendHarnessCommand(session, "hideCompletion");
      await waitForEvent(session, (event) => event.type === "completion_hide", {
        startIndex: hideStart,
        timeoutMs: 10_000,
        label: "completion hide without confirm",
      });
      await Bun.sleep(200);

      const trailingEvents = readEvents(session).slice(hideStart);
      expect(
        trailingEvents.some((event) => event.type === "completion_confirm"),
      ).toBe(false);
    },
  );

  await withHarness({}, async (session) => {
    await sendHarnessCommand(session, "setValue", {
      text: "resize-smoke-value",
    });

    await resizeSession(session, 100, 30);
    await resizeSession(session, 80, 24);

    const value = await sendHarnessCommand<string>(session, "getValue");
    expect(value).toBe("resize-smoke-value");

    const snapshot = await snapshotText(session);
    expect(snapshot).toContain("Nvim API harness");
  });
}, 300_000);
