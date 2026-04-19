/** @jsxImportSource @opentui/solid */

import { RGBA } from "@opentui/core";
import type {
  TuiHostSlotMap,
  TuiPluginApi,
  TuiThemeCurrent,
} from "@opencode-ai/plugin/tui";
import { Match, Switch, type JSX } from "solid-js";

export const EmptyBorder = {
  topLeft: "",
  bottomLeft: "",
  vertical: "",
  topRight: "",
  bottomRight: "",
  horizontal: " ",
  bottomT: "",
  topT: "",
  cross: "",
  leftT: "",
  rightT: "",
};

export const SplitBorder = {
  border: ["left", "right"] as const,
  customBorderChars: {
    ...EmptyBorder,
    vertical: "┃",
  },
};

export const defaultHomePromptPlaceholders = {
  normal: [
    "Fix a TODO in the codebase",
    "What is the tech stack of this project?",
    "Fix broken tests",
  ],
  shell: ["ls -la", "git status", "pwd"],
};

export type DefaultPromptMode = "normal" | "shell";

export type DefaultPromptStatus =
  | {
      type: "idle";
    }
  | {
      type: "busy";
      message?: string;
      interrupting?: boolean;
    }
  | {
      type: "retry";
      message: string;
      interrupting?: boolean;
    };

export type DefaultPromptUsage = {
  context?: string;
  cost?: string;
};

export type DefaultPromptChromeProps = {
  theme: TuiThemeCurrent;
  input: JSX.Element;
  visible?: boolean;
  mode?: DefaultPromptMode;
  right?: JSX.Element;
  hint?: JSX.Element;
  status?: DefaultPromptStatus;
  usage?: DefaultPromptUsage;
  agentName?: string;
  agentColor?: RGBA;
  modelName?: string;
  providerName?: string;
  variant?: string;
  leader?: boolean;
  agentsKeyHint?: string;
  commandsKeyHint?: string;
  shellExitKeyHint?: string;
};

export type DefaultHomePromptMirrorProps = Omit<
  DefaultPromptChromeProps,
  "theme" | "right"
> & {
  api: TuiPluginApi;
  slotProps: TuiHostSlotMap["home_prompt"];
  right?: JSX.Element;
};

export function getDefaultHomePromptPlaceholder(
  mode: DefaultPromptMode,
  index = 0,
) {
  const list =
    mode === "shell"
      ? defaultHomePromptPlaceholders.shell
      : defaultHomePromptPlaceholders.normal;
  if (list.length === 0) return undefined;
  const value = list[((index % list.length) + list.length) % list.length];
  if (mode === "shell") return `Run a command... \"${value}\"`;
  return `Ask anything... \"${value}\"`;
}

export function renderDefaultHomePromptRight(
  api: TuiPluginApi,
  workspace_id?: string,
) {
  return api.ui.Slot({
    name: "home_prompt_right",
    workspace_id,
  });
}

function fadeColor(color: RGBA, alpha: number) {
  return RGBA.fromValues(color.r, color.g, color.b, color.a * alpha);
}

function tint(base: RGBA, overlay: RGBA, alpha: number) {
  const r = base.r + (overlay.r - base.r) * alpha;
  const g = base.g + (overlay.g - base.g) * alpha;
  const b = base.b + (overlay.b - base.b) * alpha;
  return RGBA.fromInts(
    Math.round(r * 255),
    Math.round(g * 255),
    Math.round(b * 255),
  );
}

function titlecase(value: string) {
  return value.replace(/(^|\s)\S/g, (match) => match.toUpperCase());
}

function statusText(status: DefaultPromptStatus) {
  if (status.type === "retry") return status.message;
  if (status.type === "busy") return status.message ?? "Working...";
  return undefined;
}

function renderKeyHint(theme: TuiThemeCurrent, hint: string, label: string) {
  return (
    <text fg={theme.text}>
      {hint} <span style={{ fg: theme.textMuted }}>{label}</span>
    </text>
  );
}

// Mirrors the upstream prompt chrome so the input renderable can be swapped independently.
export function DefaultPromptChrome(props: DefaultPromptChromeProps) {
  const theme = props.theme;
  const mode = props.mode ?? "normal";
  const status = props.status ?? { type: "idle" as const };
  const showAgentMeta = mode === "shell" || Boolean(props.agentName);
  const highlight = props.leader
    ? theme.border
    : mode === "shell"
      ? theme.primary
      : (props.agentColor ?? theme.border);
  const borderHighlight = tint(theme.border, highlight, showAgentMeta ? 1 : 0);
  const usageText = [props.usage?.context, props.usage?.cost]
    .filter((value): value is string => Boolean(value))
    .join(" · ");
  const busyText = statusText(status);

  return (
    <box visible={props.visible !== false}>
      <box
        border={["left"]}
        borderColor={borderHighlight}
        customBorderChars={{
          ...SplitBorder.customBorderChars,
          bottomLeft: "╹",
        }}
      >
        <box
          paddingLeft={2}
          paddingRight={2}
          paddingTop={1}
          flexShrink={0}
          backgroundColor={theme.backgroundElement}
          flexGrow={1}
        >
          {props.input}
          <box
            flexDirection="row"
            flexShrink={0}
            paddingTop={1}
            gap={1}
            justifyContent="space-between"
          >
            <box flexDirection="row" gap={1}>
              {showAgentMeta ? (
                <>
                  <text fg={fadeColor(theme.primary, 1)}>
                    {mode === "shell"
                      ? "Shell"
                      : titlecase(props.agentName ?? "")}
                  </text>
                  {mode === "normal" ? (
                    <box flexDirection="row" gap={1}>
                      {props.modelName ? (
                        <>
                          <text
														marginLeft={1}
                            flexShrink={0}
                            fg={fadeColor(
                              props.leader ? theme.textMuted : theme.text,
                              1,
                            )}
                          >
                            {props.modelName}
                          </text>
                        </>
                      ) : null}
                      {props.providerName ? (
                        <text fg={fadeColor(theme.textMuted, 1)}>
                          {props.providerName}
                        </text>
                      ) : null}
                      {props.variant ? (
                        <>
                          <text fg={fadeColor(theme.textMuted, 1)}>·</text>
                          <text>
                            <span
                              style={{
                                fg: fadeColor(theme.warning, 1),
                                bold: true,
                              }}
                            >
                              {props.variant}
                            </span>
                          </text>
                        </>
                      ) : null}
                    </box>
                  ) : null}
                </>
              ) : (
                <box height={1} />
              )}
            </box>
            {props.right ? (
              <box flexDirection="row" gap={1} alignItems="center">
                {props.right}
              </box>
            ) : null}
          </box>
        </box>
      </box>
      <box
        height={1}
        border={["left"]}
        borderColor={borderHighlight}
        customBorderChars={{
          ...EmptyBorder,
          vertical: theme.backgroundElement.a !== 0 ? "╹" : " ",
        }}
      >
        <box
          height={1}
          border={["bottom"]}
          borderColor={theme.backgroundElement}
          customBorderChars={
            theme.backgroundElement.a !== 0
              ? {
                  ...EmptyBorder,
                  horizontal: "▀",
                }
              : {
                  ...EmptyBorder,
                  horizontal: " ",
                }
          }
        />
      </box>
      <box width="100%" flexDirection="row" justifyContent="space-between">
        {status.type !== "idle" ? (
          <box
            flexDirection="row"
            gap={1}
            flexGrow={1}
            justifyContent={
              status.type === "retry" ? "space-between" : "flex-start"
            }
          >
            <box flexShrink={0} flexDirection="row" gap={1}>
              <box marginLeft={1}>
                <text fg={theme.textMuted}>[⋯]</text>
              </box>
              <box flexDirection="row" gap={1} flexShrink={0}>
                {busyText ? (
                  <text
                    fg={status.type === "retry" ? theme.error : theme.textMuted}
                  >
                    {busyText}
                  </text>
                ) : null}
              </box>
            </box>
            <text fg={status.interrupting ? theme.primary : theme.text}>
              esc{" "}
              <span
                style={{
                  fg: status.interrupting ? theme.primary : theme.textMuted,
                }}
              >
                {status.interrupting ? "again to interrupt" : "interrupt"}
              </span>
            </text>
          </box>
        ) : (
          (props.hint ?? <text />)
        )}
        {status.type !== "retry" ? (
          <box gap={2} flexDirection="row">
            <Switch>
              <Match when={mode === "normal"}>
                {usageText ? (
                  <text fg={theme.textMuted} wrapMode="none">
                    {usageText}
                  </text>
                ) : (
                  renderKeyHint(theme, props.agentsKeyHint ?? "tab", "agents")
                )}
                {renderKeyHint(theme, props.commandsKeyHint ?? "/", "commands")}
              </Match>
              <Match when={mode === "shell"}>
                {renderKeyHint(
                  theme,
                  props.shellExitKeyHint ?? "esc",
                  "exit shell mode",
                )}
              </Match>
            </Switch>
          </box>
        ) : null}
      </box>
    </box>
  );
}

export function DefaultHomePromptMirror(props: DefaultHomePromptMirrorProps) {
  return (
    <DefaultPromptChrome
      theme={props.api.theme.current}
      input={props.input}
      visible={props.visible}
      mode={props.mode}
      right={
        props.right ??
        renderDefaultHomePromptRight(props.api, props.slotProps.workspace_id)
      }
      hint={props.hint}
      status={props.status}
      usage={props.usage}
      agentName={props.agentName}
      agentColor={props.agentColor}
      modelName={props.modelName}
      providerName={props.providerName}
      variant={props.variant}
      leader={props.leader}
      agentsKeyHint={props.agentsKeyHint}
      commandsKeyHint={props.commandsKeyHint}
      shellExitKeyHint={props.shellExitKeyHint}
    />
  );
}
