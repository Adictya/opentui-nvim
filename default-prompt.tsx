/** @jsxImportSource @opentui/solid */

import { RGBA } from "@opentui/core";
import type { TuiPluginApi, TuiThemeCurrent } from "@opencode-ai/plugin/tui";
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

export type DefaultPromptActiveStatus = Exclude<
  DefaultPromptStatus,
  { type: "idle" }
>;

export type DefaultPromptUsage = {
  context?: string;
  cost?: string;
};

export type DefaultPromptChromeProps = {
  theme: TuiThemeCurrent;
  input: JSX.Element;
  onInputMouseDown?: () => void;
  modeLabelRef?: (value: unknown) => void;
  visible?: boolean;
  mode?: DefaultPromptMode;
  modeLabel?: string;
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
  | "theme"
  | "right"
  | "agentName"
  | "agentColor"
  | "modelName"
  | "providerName"
  | "variant"
> & {
  api: TuiPluginApi;
  children?: JSX.Element;
};

export type DefaultPromptRootProps = {
  visible?: boolean;
  children: JSX.Element;
};

export type DefaultPromptFrameProps = {
  theme: TuiThemeCurrent;
  borderColor: RGBA;
  input: JSX.Element;
  onInputMouseDown?: () => void;
  children: JSX.Element;
};

export type DefaultPromptMetaProps = Pick<
  DefaultPromptChromeProps,
  | "theme"
  | "mode"
  | "modeLabel"
  | "modeLabelRef"
  | "right"
  | "agentName"
  | "modelName"
  | "providerName"
  | "variant"
  | "leader"
> & {
  highlight: RGBA;
};

export type DefaultPromptFooterSpacerProps = {
  theme: TuiThemeCurrent;
  borderColor: RGBA;
};

export type DefaultPromptFooterProps = Pick<
  DefaultPromptChromeProps,
  | "theme"
  | "mode"
  | "hint"
  | "status"
  | "usage"
  | "agentsKeyHint"
  | "commandsKeyHint"
  | "shellExitKeyHint"
>;

export type DefaultPromptKeyHintProps = {
  theme: TuiThemeCurrent;
  hint: string;
  label: string;
};

export type DefaultPromptModel = {
  modelID: string;
  providerID: string;
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

export function DefaultHomePromptRight(props: {
  api: TuiPluginApi;
  workspace_id?: string;
}) {
  return renderDefaultHomePromptRight(props.api, props.workspace_id);
}

function parseModel(value?: string) {
  if (!value) return;

  const [providerID, ...rest] = value.split("/");
  if (!providerID || rest.length === 0) return;
  return {
    modelID: rest.join("/"),
    providerID,
  } satisfies DefaultPromptModel;
}

function resolveConfiguredModel(api: TuiPluginApi) {
  const configured = parseModel(api.state.config.model);
  if (configured) return configured;

  for (const provider of api.state.provider) {
    const modelID = Object.keys(provider.models)[0];
    if (!modelID) continue;
    return {
      modelID,
      providerID: provider.id,
    } satisfies DefaultPromptModel;
  }
}

function resolveAgentColor(api: TuiPluginApi, agentName: string) {
  const configured = api.state.config.agent?.[agentName]?.color;
  if (typeof configured !== "string") return api.theme.current.primary;
  if (configured.startsWith("#")) {
    try {
      return RGBA.fromHex(configured);
    } catch {
      return api.theme.current.primary;
    }
  }

  const value = api.theme.current[configured as keyof typeof api.theme.current];
  return value instanceof RGBA ? value : api.theme.current.primary;
}

function resolveAgentName(api: TuiPluginApi) {
  return api.state.config.default_agent ?? "build";
}

function resolveAgentVariant(api: TuiPluginApi, agentName: string) {
  const variant = api.state.config.agent?.[agentName]?.variant;
  return typeof variant === "string" ? variant : undefined;
}

function resolveModelMeta(api: TuiPluginApi) {
  const configuredModel = resolveConfiguredModel(api);
  const provider = configuredModel
    ? api.state.provider.find((item) => item.id === configuredModel.providerID)
    : undefined;
  const model =
    configuredModel && provider
      ? provider.models[configuredModel.modelID]
      : undefined;

  return {
    modelName: model?.name ?? configuredModel?.modelID,
    providerName: provider?.name ?? configuredModel?.providerID,
  };
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

export function DefaultPromptRoot(props: DefaultPromptRootProps) {
  return <box visible={props.visible !== false}>{props.children}</box>;
}

export function DefaultPromptKeyHint(props: DefaultPromptKeyHintProps) {
  return (
    <text fg={props.theme.text}>
      {props.hint}{" "}
      <span style={{ fg: props.theme.textMuted }}>{props.label}</span>
    </text>
  );
}

export function DefaultPromptFrame(props: DefaultPromptFrameProps) {
  return (
    <box
      border={["left"]}
      borderColor={props.borderColor}
      customBorderChars={{ ...SplitBorder.customBorderChars, bottomLeft: "╹" }}
    >
      <box
        paddingLeft={2}
        paddingRight={2}
        paddingTop={1}
        flexShrink={0}
        backgroundColor={props.theme.backgroundElement}
        flexGrow={1}
      >
        <box onMouseDown={() => props.onInputMouseDown?.()}>{props.input}</box>
        {props.children}
      </box>
    </box>
  );
}

export function DefaultPromptMeta(props: DefaultPromptMetaProps) {
  const theme = props.theme;
  const mode = props.mode ?? "normal";
  const showAgentMeta =
    Boolean(props.modeLabel) || mode === "shell" || Boolean(props.agentName);

  return (
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
            {props.modeLabel ? (
              <>
                <text
                  ref={props.modeLabelRef}
                  fg={fadeColor(theme.textMuted, 1)}
                >
                  {props.modeLabel}
                </text>
                <text fg={fadeColor(theme.textMuted, 1)}>·</text>
              </>
            ) : null}
            <text fg={fadeColor(props.highlight, 1)}>
              {mode === "shell" ? "Shell" : titlecase(props.agentName ?? "")}
            </text>
            {mode === "normal" ? <DefaultPromptModelMeta {...props} /> : null}
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
  );
}

export function DefaultPromptModelMeta(props: DefaultPromptMetaProps) {
  const theme = props.theme;

  return (
    <box flexDirection="row" gap={1}>
      {props.modelName ? (
        <>
          <text fg={fadeColor(theme.textMuted, 1)}>·</text>
          <text
            flexShrink={0}
            fg={fadeColor(props.leader ? theme.textMuted : theme.text, 1)}
          >
            {props.modelName}
          </text>
        </>
      ) : null}
      {props.providerName ? (
        <text fg={fadeColor(theme.textMuted, 1)}>{props.providerName}</text>
      ) : null}
      {props.variant ? (
        <>
          <text fg={fadeColor(theme.textMuted, 1)}>·</text>
          <text>
            <span style={{ fg: fadeColor(theme.warning, 1), bold: true }}>
              {props.variant}
            </span>
          </text>
        </>
      ) : null}
    </box>
  );
}

export function DefaultPromptFooterSpacer(
  props: DefaultPromptFooterSpacerProps,
) {
  return (
    <box
      height={1}
      border={["left"]}
      borderColor={props.borderColor}
      customBorderChars={{
        ...EmptyBorder,
        vertical: props.theme.backgroundElement.a !== 0 ? "╹" : " ",
      }}
    >
      <box
        height={1}
        border={["bottom"]}
        borderColor={props.theme.backgroundElement}
        customBorderChars={
          props.theme.backgroundElement.a !== 0
            ? { ...EmptyBorder, horizontal: "▀" }
            : { ...EmptyBorder, horizontal: " " }
        }
      />
    </box>
  );
}

export function DefaultPromptFooter(props: DefaultPromptFooterProps) {
  const theme = props.theme;
  const mode = props.mode ?? "normal";
  const status = props.status ?? { type: "idle" as const };
  const usageText = [props.usage?.context, props.usage?.cost]
    .filter((value): value is string => Boolean(value))
    .join(" · ");

  return (
    <box width="100%" flexDirection="row" justifyContent="space-between">
      {status.type !== "idle" ? (
        <DefaultPromptStatus theme={theme} status={status} />
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
                <DefaultPromptKeyHint
                  theme={theme}
                  hint={props.agentsKeyHint ?? "tab"}
                  label="agents"
                />
              )}
              <DefaultPromptKeyHint
                theme={theme}
                hint={props.commandsKeyHint ?? "/"}
                label="commands"
              />
            </Match>
            <Match when={mode === "shell"}>
              <DefaultPromptKeyHint
                theme={theme}
                hint={props.shellExitKeyHint ?? "esc"}
                label="exit shell mode"
              />
            </Match>
          </Switch>
        </box>
      ) : null}
    </box>
  );
}

export function DefaultPromptStatus(props: {
  theme: TuiThemeCurrent;
  status: DefaultPromptActiveStatus;
}) {
  const busyText = statusText(props.status);

  return (
    <box
      flexDirection="row"
      gap={1}
      flexGrow={1}
      justifyContent={
        props.status.type === "retry" ? "space-between" : "flex-start"
      }
    >
      <box flexShrink={0} flexDirection="row" gap={1}>
        <box marginLeft={1}>
          <text fg={props.theme.textMuted}>[⋯]</text>
        </box>
        <box flexDirection="row" gap={1} flexShrink={0}>
          {busyText ? (
            <text
              fg={
                props.status.type === "retry"
                  ? props.theme.error
                  : props.theme.textMuted
              }
            >
              {busyText}
            </text>
          ) : null}
        </box>
      </box>
      <text
        fg={props.status.interrupting ? props.theme.primary : props.theme.text}
      >
        esc{" "}
        <span
          style={{
            fg: props.status.interrupting
              ? props.theme.primary
              : props.theme.textMuted,
          }}
        >
          {props.status.interrupting ? "again to interrupt" : "interrupt"}
        </span>
      </text>
    </box>
  );
}

// Mirrors the upstream prompt chrome so the input renderable can be swapped independently.
export function DefaultPromptChrome(props: DefaultPromptChromeProps) {
  const theme = props.theme;
  const mode = props.mode ?? "normal";
  const showAgentMeta =
    Boolean(props.modeLabel) || mode === "shell" || Boolean(props.agentName);
  const highlight = props.leader
    ? theme.border
    : mode === "shell"
      ? theme.primary
      : (props.agentColor ?? theme.border);
  const borderHighlight = tint(theme.border, highlight, showAgentMeta ? 1 : 0);

  return (
    <DefaultPromptRoot visible={props.visible}>
      <DefaultPromptFrame
        theme={theme}
        borderColor={borderHighlight}
        input={props.input}
        onInputMouseDown={props.onInputMouseDown}
      >
        <DefaultPromptMeta {...props} mode={mode} highlight={highlight} />
      </DefaultPromptFrame>
      <DefaultPromptFooterSpacer theme={theme} borderColor={borderHighlight} />
      <DefaultPromptFooter {...props} mode={mode} />
    </DefaultPromptRoot>
  );
}

export function DefaultHomePromptMirror(props: DefaultHomePromptMirrorProps) {
  const agentName = resolveAgentName(props.api);
  const modelMeta = resolveModelMeta(props.api);

  return (
    <DefaultPromptChrome
      theme={props.api.theme.current}
      input={props.input}
      onInputMouseDown={props.onInputMouseDown}
      modeLabelRef={props.modeLabelRef}
      visible={props.visible}
      mode={props.mode}
      modeLabel={props.modeLabel}
      right={props.children}
      hint={props.hint}
      status={props.status}
      usage={props.usage}
      agentName={agentName}
      agentColor={resolveAgentColor(props.api, agentName)}
      modelName={modelMeta.modelName}
      providerName={modelMeta.providerName}
      variant={resolveAgentVariant(props.api, agentName)}
      leader={props.leader}
      agentsKeyHint={props.agentsKeyHint}
      commandsKeyHint={props.commandsKeyHint}
      shellExitKeyHint={props.shellExitKeyHint}
    />
  );
}
