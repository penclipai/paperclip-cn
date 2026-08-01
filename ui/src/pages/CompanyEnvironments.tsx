import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import {
  ArrowLeft,
  Check,
  Play,
  RefreshCw,
  RotateCcw,
  Terminal,
  Trash2,
  X,
} from "lucide-react";
import { FitAddon } from "@xterm/addon-fit";
import { Terminal as XTermTerminal } from "@xterm/xterm";
import "@xterm/xterm/css/xterm.css";
import {
  type EnvBinding,
  type Environment,
  type EnvironmentProviderCapability,
  type EnvironmentProbeResult,
  type EnvironmentCustomImageSetupSession,
  type JsonSchema,
} from "@penclipai/shared";
import {
  environmentsApi,
  type EnvironmentCustomImageConnectionPayload,
  type EnvironmentCustomImageSetupSessionResult,
  type EnvironmentUpdateResult,
} from "@/api/environments";
import { instanceSettingsApi } from "@/api/instanceSettings";
import { secretsApi } from "@/api/secrets";
import { Button } from "@/components/ui/button";
import {
  EnvironmentVariablesEditor,
  type EnvironmentVariablesEditorHandle,
} from "@/components/environment-variables-editor";
import {
  JsonSchemaForm,
  getDefaultValues,
  validateJsonSchemaForm,
} from "@/components/JsonSchemaForm";
import {
  SecretRefHintsContext,
  type SecretRefHint,
  type SecretRefHintsContextValue,
} from "@/components/SecretBindingPicker";
import { useBreadcrumbs } from "@/context/BreadcrumbContext";
import { useCompany } from "@/context/CompanyContext";
import { useToast } from "@/context/ToastContext";
import { queryKeys } from "@/lib/queryKeys";
import { Link, useNavigate, useParams } from "@/lib/router";
import { buildSameOriginWebSocketUrl } from "@/lib/websocket-url";
import { Field, ToggleField } from "../components/agent-config-primitives";

type EnvironmentFormState = {
  name: string;
  description: string;
  driver: "local" | "ssh" | "sandbox";
  sshHost: string;
  sshPort: string;
  sshUsername: string;
  sshRemoteWorkspacePath: string;
  sshPrivateKey: string;
  sshPrivateKeySecretId: string;
  sshKnownHosts: string;
  sshStrictHostKeyChecking: boolean;
  sandboxProvider: string;
  sandboxConfig: Record<string, unknown>;
  envVars: Record<string, EnvBinding>;
};

type CompanyEnvironmentsMode = "list" | "create" | "edit";

type CompanyEnvironmentsProps = {
  mode?: CompanyEnvironmentsMode;
};

const ENVIRONMENTS_PATH = "/company/settings/instance/environments";

function environmentEditPath(environmentId: string) {
  return `${ENVIRONMENTS_PATH}/${encodeURIComponent(environmentId)}/edit`;
}

function buildEnvironmentPayload(form: EnvironmentFormState) {
  return {
    name: form.name.trim(),
    description: form.description.trim() || null,
    driver: form.driver,
    envVars: form.envVars,
    config:
      form.driver === "ssh"
        ? {
            host: form.sshHost.trim(),
            port: Number.parseInt(form.sshPort || "22", 10) || 22,
            username: form.sshUsername.trim(),
            remoteWorkspacePath: form.sshRemoteWorkspacePath.trim(),
            privateKey: form.sshPrivateKey.trim() || null,
            privateKeySecretRef:
              form.sshPrivateKey.trim().length > 0 ||
              !form.sshPrivateKeySecretId
                ? null
                : {
                    type: "secret_ref" as const,
                    secretId: form.sshPrivateKeySecretId,
                    version: "latest" as const,
                  },
            knownHosts: form.sshKnownHosts.trim() || null,
            strictHostKeyChecking: form.sshStrictHostKeyChecking,
          }
        : form.driver === "sandbox"
          ? {
              provider: form.sandboxProvider.trim(),
              ...form.sandboxConfig,
            }
          : {},
  } as const;
}

function createEmptyEnvironmentForm(): EnvironmentFormState {
  return {
    name: "",
    description: "",
    driver: "ssh",
    sshHost: "",
    sshPort: "22",
    sshUsername: "",
    sshRemoteWorkspacePath: "",
    sshPrivateKey: "",
    sshPrivateKeySecretId: "",
    sshKnownHosts: "",
    sshStrictHostKeyChecking: true,
    sandboxProvider: "",
    sandboxConfig: {},
    envVars: {},
  };
}

function isLocalEnvironment(environment: Environment | null | undefined) {
  return environment?.driver === "local";
}

function normalizeNonLocalEnvironmentId(
  environmentId: string | null | undefined,
  environments: readonly Environment[],
): string {
  if (!environmentId) return "";
  const environment =
    environments.find((candidate) => candidate.id === environmentId) ?? null;
  return isLocalEnvironment(environment) ? "" : environmentId;
}

function readSshConfig(environment: Environment) {
  const config = environment.config ?? {};
  return {
    host: typeof config.host === "string" ? config.host : "",
    port:
      typeof config.port === "number"
        ? String(config.port)
        : typeof config.port === "string"
          ? config.port
          : "22",
    username: typeof config.username === "string" ? config.username : "",
    remoteWorkspacePath:
      typeof config.remoteWorkspacePath === "string"
        ? config.remoteWorkspacePath
        : "",
    privateKey: "",
    privateKeySecretId:
      config.privateKeySecretRef &&
      typeof config.privateKeySecretRef === "object" &&
      !Array.isArray(config.privateKeySecretRef) &&
      typeof (config.privateKeySecretRef as { secretId?: unknown }).secretId ===
        "string"
        ? String((config.privateKeySecretRef as { secretId: string }).secretId)
        : "",
    knownHosts: typeof config.knownHosts === "string" ? config.knownHosts : "",
    strictHostKeyChecking:
      typeof config.strictHostKeyChecking === "boolean"
        ? config.strictHostKeyChecking
        : true,
  };
}

function readSandboxConfig(environment: Environment) {
  const config = environment.config ?? {};
  const { provider: rawProvider, ...providerConfig } = config;
  return {
    provider:
      typeof rawProvider === "string" && rawProvider.trim().length > 0
        ? rawProvider
        : "fake",
    config: providerConfig,
  };
}

function createEnvironmentFormFromEnvironment(
  environment: Environment,
): EnvironmentFormState {
  if (environment.driver === "ssh") {
    const ssh = readSshConfig(environment);
    return {
      ...createEmptyEnvironmentForm(),
      name: environment.name,
      description: environment.description ?? "",
      driver: "ssh",
      sshHost: ssh.host,
      sshPort: ssh.port,
      sshUsername: ssh.username,
      sshRemoteWorkspacePath: ssh.remoteWorkspacePath,
      sshPrivateKey: ssh.privateKey,
      sshPrivateKeySecretId: ssh.privateKeySecretId,
      sshKnownHosts: ssh.knownHosts,
      sshStrictHostKeyChecking: ssh.strictHostKeyChecking,
      envVars: environment.envVars ?? {},
    };
  }

  if (environment.driver === "sandbox") {
    const sandbox = readSandboxConfig(environment);
    return {
      ...createEmptyEnvironmentForm(),
      name: environment.name,
      description: environment.description ?? "",
      driver: "sandbox",
      sandboxProvider: sandbox.provider,
      sandboxConfig: sandbox.config,
      envVars: environment.envVars ?? {},
    };
  }

  return {
    ...createEmptyEnvironmentForm(),
    name: environment.name,
    description: environment.description ?? "",
    driver: "local",
    envVars: environment.envVars ?? {},
  };
}

const DISCARD_ENVIRONMENT_CHANGES_MESSAGE =
  "Discard unsaved environment changes?";

function stableJsonStringify(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map((item) => stableJsonStringify(item)).join(",")}]`;
  }
  if (value && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, entryValue]) => entryValue !== undefined)
      .sort(([left], [right]) => left.localeCompare(right));
    return `{${entries
      .map(
        ([key, entryValue]) =>
          `${JSON.stringify(key)}:${stableJsonStringify(entryValue)}`,
      )
      .join(",")}}`;
  }
  return JSON.stringify(value) ?? "undefined";
}

/** Payload-level fingerprint so cosmetic form state (whitespace, key order) is not "unsaved". */
function environmentFormKey(form: EnvironmentFormState): string {
  return stableJsonStringify(buildEnvironmentPayload(form));
}

function normalizeJsonSchema(schema: unknown): JsonSchema | null {
  return schema && typeof schema === "object" && !Array.isArray(schema)
    ? (schema as JsonSchema)
    : null;
}

function summarizeSandboxConfig(
  config: Record<string, unknown>,
): string | null {
  for (const key of ["template", "image", "region", "workspacePath"]) {
    const value = config[key];
    if (typeof value === "string" && value.trim().length > 0) {
      return value;
    }
  }
  return null;
}

const ACTIVE_CUSTOM_IMAGE_SETUP_STATUSES = new Set<
  EnvironmentCustomImageSetupSession["status"]
>(["starting", "waiting_for_user", "capturing"]);

function isActiveCustomImageSetupSession(
  session: EnvironmentCustomImageSetupSession | null | undefined,
) {
  return Boolean(
    session && ACTIVE_CUSTOM_IMAGE_SETUP_STATUSES.has(session.status),
  );
}

function readEnvironmentSandboxProvider(
  environment: Environment,
): string | null {
  return environment.driver === "sandbox" &&
    typeof environment.config.provider === "string"
    ? environment.config.provider
    : null;
}

function formatDateTime(
  value: string | Date | null | undefined,
): string | null {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toLocaleString();
}

function formatShortId(value: string): string {
  const normalized = value.trim();
  if (normalized.length <= 12) return normalized;
  return `${normalized.slice(0, 12)}…`;
}

function readConnectionCommand(
  payload: EnvironmentCustomImageConnectionPayload | null | undefined,
): string | null {
  return typeof payload?.command === "string" &&
    payload.command.trim().length > 0
    ? payload.command
    : null;
}

function setupConnectionFallbackMessage(input: {
  payload: EnvironmentCustomImageConnectionPayload | null;
  refreshError: unknown;
  isLoading: boolean;
}): string | null {
  if (input.refreshError) {
    return "Setup connection details could not be refreshed. You can still finish or cancel this setup.";
  }
  if (input.isLoading) return null;
  if (!input.payload) {
    return "Connection details are not available yet. You can still finish or cancel this setup.";
  }
  if (input.payload.type !== "ssh") {
    return "Browser terminal is not available for this provider connection. Use the provider setup instructions, then finish or cancel here.";
  }
  if (!readConnectionCommand(input.payload)) {
    return "Connection details are not available yet. You can still finish or cancel this setup.";
  }
  return null;
}

const CUSTOM_IMAGE_TERMINAL_COLS = 100;
const CUSTOM_IMAGE_TERMINAL_ROWS = 28;
const CUSTOM_IMAGE_TERMINAL_SCROLLBACK_ROWS = 5_000;
const CUSTOM_IMAGE_TERMINAL_FONT_FAMILY = [
  "MesloLGS NF",
  "MesloLGS Nerd Font Mono",
  "CaskaydiaCove Nerd Font Mono",
  "CaskaydiaMono Nerd Font",
  "JetBrainsMono Nerd Font",
  "FiraCode Nerd Font Mono",
  "Symbols Nerd Font Mono",
  "Menlo",
  "Monaco",
  "Consolas",
  "Liberation Mono",
  "monospace",
].join(", ");

type CustomImageTerminalConnectionState =
  | "idle"
  | "connecting"
  | "connected"
  | "closed"
  | "error";

function appendTerminalQuery(
  path: string,
  params: Record<string, string | number>,
) {
  const separator = path.includes("?") ? "&" : "?";
  return `${path}${separator}${new URLSearchParams(
    Object.fromEntries(
      Object.entries(params).map(([key, value]) => [key, String(value)]),
    ),
  ).toString()}`;
}

function parseTerminalFrame(raw: string): Record<string, unknown> | null {
  try {
    const parsed = JSON.parse(raw) as unknown;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

function customImageTerminalStatusCopy(
  state: CustomImageTerminalConnectionState,
) {
  switch (state) {
    case "connecting":
      return "Connecting";
    case "connected":
      return "Connected";
    case "closed":
      return "Closed";
    case "error":
      return "Connection failed";
    case "idle":
    default:
      return "Ready to connect";
  }
}

function customImageTerminalCloseReasonCopy(reason: unknown) {
  if (
    reason !== "expired" &&
    reason !== "ssh_closed" &&
    reason !== "server_shutdown" &&
    reason !== "setup_finished" &&
    reason !== "setup_cancelled"
  ) {
    return typeof reason === "string" && reason.trim()
      ? "Terminal closed."
      : null;
  }

  switch (reason) {
    case "expired":
      return "Setup session expired.";
    case "ssh_closed":
      return "SSH session closed.";
    case "server_shutdown":
      return "Terminal server shut down.";
    case "setup_finished":
      return "Setup session finished.";
    case "setup_cancelled":
      return "Setup session cancelled.";
    default:
      return null;
  }
}

function EnvironmentCustomImageBrowserTerminal({
  autoConnect = false,
  sessionId,
}: {
  autoConnect?: boolean;
  sessionId: string;
}) {
  const { t } = useTranslation();
  const [connectionState, setConnectionState] =
    useState<CustomImageTerminalConnectionState>("idle");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const terminalElementRef = useRef<HTMLDivElement | null>(null);
  const xtermRef = useRef<XTermTerminal | null>(null);
  const fitAddonRef = useRef<FitAddon | null>(null);
  const terminalInputDisposableRef = useRef<{ dispose: () => void } | null>(
    null,
  );
  const resizeObserverRef = useRef<ResizeObserver | null>(null);
  const fitFrameRef = useRef<number | null>(null);
  const socketRef = useRef<WebSocket | null>(null);
  const autoConnectAttemptedSessionRef = useRef<string | null>(null);
  const lastSentResizeRef = useRef<{ cols: number; rows: number } | null>(null);

  const closeSocket = useCallback((reason = "operator_closed") => {
    const socket = socketRef.current;
    socketRef.current = null;
    if (
      socket &&
      socket.readyState !== WebSocket.CLOSED &&
      socket.readyState !== WebSocket.CLOSING
    ) {
      socket.close(1000, reason);
    }
  }, []);

  const getTerminalDimensions = useCallback(() => {
    const terminal = xtermRef.current;
    return {
      cols: terminal?.cols || CUSTOM_IMAGE_TERMINAL_COLS,
      rows: terminal?.rows || CUSTOM_IMAGE_TERMINAL_ROWS,
    };
  }, []);

  const sendTerminalResize = useCallback(
    (force = false) => {
      const socket = socketRef.current;
      if (!socket || socket.readyState !== WebSocket.OPEN) return;

      const dimensions = getTerminalDimensions();
      const previous = lastSentResizeRef.current;
      if (
        !force &&
        previous?.cols === dimensions.cols &&
        previous.rows === dimensions.rows
      )
        return;

      lastSentResizeRef.current = dimensions;
      socket.send(
        JSON.stringify({
          type: "resize",
          cols: dimensions.cols,
          rows: dimensions.rows,
        }),
      );
    },
    [getTerminalDimensions],
  );

  const fitTerminal = useCallback(() => {
    const fitAddon = fitAddonRef.current;
    if (!fitAddon || !xtermRef.current) return;
    try {
      fitAddon.fit();
      sendTerminalResize();
    } catch {
      // The fit addon can throw during hidden/dialog layout transitions. The
      // next ResizeObserver tick or reconnect will retry with stable dimensions.
    }
  }, [sendTerminalResize]);

  const requestFitTerminal = useCallback(() => {
    if (fitFrameRef.current !== null) {
      window.cancelAnimationFrame(fitFrameRef.current);
    }
    fitFrameRef.current = window.requestAnimationFrame(() => {
      fitFrameRef.current = null;
      fitTerminal();
    });
  }, [fitTerminal]);

  const sendTerminalInput = useCallback((data: string) => {
    const socket = socketRef.current;
    if (!socket || socket.readyState !== WebSocket.OPEN) return;
    socket.send(JSON.stringify({ type: "input", data }));
  }, []);

  const resetTerminalScreen = useCallback(() => {
    const terminal = xtermRef.current;
    if (!terminal) return;
    terminal.reset();
    terminal.clear();
  }, []);

  useEffect(() => {
    const element = terminalElementRef.current;
    if (!element || xtermRef.current) return undefined;

    const terminal = new XTermTerminal({
      allowTransparency: true,
      cols: CUSTOM_IMAGE_TERMINAL_COLS,
      rows: CUSTOM_IMAGE_TERMINAL_ROWS,
      convertEol: false,
      cursorBlink: true,
      cursorInactiveStyle: "bar",
      cursorStyle: "bar",
      cursorWidth: 2,
      customGlyphs: true,
      fontFamily: CUSTOM_IMAGE_TERMINAL_FONT_FAMILY,
      fontSize: 12,
      letterSpacing: 0,
      lineHeight: 1.35,
      scrollback: CUSTOM_IMAGE_TERMINAL_SCROLLBACK_ROWS,
      theme: {
        // token-extraction: allowlisted — xterm.js terminal theme config; functional third-party option object, not a rendered CSS value.
        background: "#0a0a0a",
        foreground: "#f5f5f5",
        cursor: "#22d3ee",
        cursorAccent: "#020617",
        selectionBackground: "#2563eb55",
      },
    });
    const fitAddon = new FitAddon();
    terminal.loadAddon(fitAddon);
    terminal.open(element);

    xtermRef.current = terminal;
    fitAddonRef.current = fitAddon;
    terminalInputDisposableRef.current = terminal.onData(sendTerminalInput);

    if (typeof ResizeObserver !== "undefined") {
      const resizeObserver = new ResizeObserver(() => requestFitTerminal());
      resizeObserver.observe(element);
      resizeObserverRef.current = resizeObserver;
    }

    terminal.focus();
    requestFitTerminal();
    const fitTimeouts = [50, 250].map((delay) =>
      window.setTimeout(fitTerminal, delay),
    );
    const fontsReady =
      "fonts" in document
        ? (document as Document & { fonts?: { ready?: Promise<unknown> } })
            .fonts?.ready
        : null;
    if (fontsReady) {
      void fontsReady.then(() => fitTerminal());
    }

    return () => {
      if (fitFrameRef.current !== null) {
        window.cancelAnimationFrame(fitFrameRef.current);
        fitFrameRef.current = null;
      }
      for (const timeoutId of fitTimeouts) {
        window.clearTimeout(timeoutId);
      }
      resizeObserverRef.current?.disconnect();
      resizeObserverRef.current = null;
      terminalInputDisposableRef.current?.dispose();
      terminalInputDisposableRef.current = null;
      fitAddonRef.current = null;
      xtermRef.current = null;
      terminal.dispose();
    };
  }, [fitTerminal, requestFitTerminal, sendTerminalInput]);

  useEffect(() => () => closeSocket("component_unmounted"), [closeSocket]);

  useEffect(() => {
    closeSocket("session_changed");
    autoConnectAttemptedSessionRef.current = null;
    lastSentResizeRef.current = null;
    setConnectionState("idle");
    setErrorMessage(null);
    resetTerminalScreen();
  }, [closeSocket, resetTerminalScreen, sessionId]);

  useEffect(() => {
    if (connectionState === "connected") {
      xtermRef.current?.focus();
    }
  }, [connectionState]);

  const connectTerminal = useCallback(async () => {
    if (typeof WebSocket === "undefined") {
      setConnectionState("error");
      setErrorMessage(
        t("companySettings.customImage.terminalUnavailable", {
          defaultValue: "Browser terminal is unavailable in this browser.",
        }),
      );
      return;
    }

    closeSocket("reconnect");
    setConnectionState("connecting");
    lastSentResizeRef.current = null;
    setErrorMessage(null);
    resetTerminalScreen();
    xtermRef.current?.focus();

    try {
      fitTerminal();
      const dimensions = getTerminalDimensions();
      const terminalToken =
        await environmentsApi.createCustomImageTerminalSessionToken(
          sessionId,
          {},
        );
      const websocketPath = appendTerminalQuery(terminalToken.websocketPath, {
        cols: dimensions.cols,
        rows: dimensions.rows,
      });
      const socket = new WebSocket(buildSameOriginWebSocketUrl(websocketPath));
      socketRef.current = socket;

      socket.onopen = () => {
        if (socketRef.current !== socket) return;
        xtermRef.current?.focus();
        socket.send(
          JSON.stringify({ type: "auth", token: terminalToken.token }),
        );
        sendTerminalResize(true);
      };

      socket.onmessage = (message) => {
        if (socketRef.current !== socket) return;
        const raw = typeof message.data === "string" ? message.data : "";
        const frame = raw ? parseTerminalFrame(raw) : null;
        if (!frame) return;

        if (frame.type === "ready") {
          setConnectionState("connected");
          xtermRef.current?.focus();
          return;
        }

        if (frame.type === "output" && typeof frame.data === "string") {
          xtermRef.current?.write(frame.data as string);
          return;
        }

        if (frame.type === "error") {
          setConnectionState("error");
          setErrorMessage(
            typeof frame.message === "string"
              ? frame.message
              : t("companySettings.customImage.terminalConnectionFailed", {
                  defaultValue: "Terminal connection failed.",
                }),
          );
          return;
        }

        if (frame.type === "closed") {
          setConnectionState("closed");
          const closeReasonMessage = customImageTerminalCloseReasonCopy(
            frame.reason,
          );
          setErrorMessage(
            closeReasonMessage
              ? t(
                  `companySettings.customImage.terminalCloseReason.${String(frame.reason ?? "unknown")}`,
                  {
                    defaultValue: closeReasonMessage,
                  },
                )
              : null,
          );
        }
      };

      socket.onclose = () => {
        if (socketRef.current !== socket) return;
        socketRef.current = null;
        setConnectionState((current) =>
          current === "connected" || current === "connecting"
            ? "closed"
            : current,
        );
      };

      socket.onerror = () => {
        if (socketRef.current !== socket) return;
        setConnectionState("error");
        setErrorMessage(
          t("companySettings.customImage.terminalWebsocketFailed", {
            defaultValue: "Terminal websocket connection failed.",
          }),
        );
      };
    } catch (error) {
      setConnectionState("error");
      setErrorMessage(
        error instanceof Error
          ? error.message
          : t("companySettings.customImage.terminalOpenFailed", {
              defaultValue: "Terminal session could not be opened.",
            }),
      );
    }
  }, [
    closeSocket,
    fitTerminal,
    getTerminalDimensions,
    resetTerminalScreen,
    sendTerminalResize,
    sessionId,
    t,
  ]);

  useEffect(() => {
    if (!autoConnect || connectionState !== "idle") return;
    if (autoConnectAttemptedSessionRef.current === sessionId) return;
    const timeoutId = window.setTimeout(() => {
      autoConnectAttemptedSessionRef.current = sessionId;
      void connectTerminal();
    }, 0);
    return () => window.clearTimeout(timeoutId);
  }, [autoConnect, connectTerminal, connectionState, sessionId]);

  const disconnectTerminal = useCallback(() => {
    closeSocket("operator_closed");
    setConnectionState("closed");
  }, [closeSocket]);

  const terminalInteractive = connectionState === "connected";

  return (
    <div
      className="mt-3 rounded-md border border-border/70 bg-background"
      data-testid={`custom-image-terminal-${sessionId}`}
    >
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border/60 px-3 py-2">
        <div className="flex min-w-0 items-center gap-2 text-xs">
          <Terminal className="h-3.5 w-3.5 text-muted-foreground" />
          <span className="font-medium">
            {t("companySettings.customImage.browserTerminal", {
              defaultValue: "Browser terminal",
            })}
          </span>
          <span className="text-muted-foreground">
            {t(
              `companySettings.customImage.terminalStatus.${connectionState}`,
              {
                defaultValue: customImageTerminalStatusCopy(connectionState),
              },
            )}
          </span>
        </div>
        <div className="flex items-center gap-2">
          {terminalInteractive ? (
            <Button size="sm" variant="ghost" onClick={disconnectTerminal}>
              {t("companySettings.customImage.disconnectTerminal", {
                defaultValue: "Disconnect",
              })}
            </Button>
          ) : (
            <Button
              size="sm"
              variant="outline"
              onClick={() => void connectTerminal()}
              disabled={connectionState === "connecting"}
            >
              <Terminal className="mr-1.5 h-3.5 w-3.5" />
              {connectionState === "closed" || connectionState === "error"
                ? t("companySettings.customImage.reconnectTerminal", {
                    defaultValue: "Reconnect",
                  })
                : t("companySettings.customImage.openTerminal", {
                    defaultValue: "Open terminal",
                  })}
            </Button>
          )}
        </div>
      </div>
      <div className="bg-neutral-950 p-2 focus-within:ring-2 focus-within:ring-ring">
        <div
          ref={terminalElementRef}
          data-testid={`custom-image-terminal-screen-${sessionId}`}
          aria-label={t("companySettings.customImage.browserTerminalAria", {
            defaultValue: "Custom image browser terminal",
          })}
          role="application"
          tabIndex={0}
          onFocus={() => xtermRef.current?.focus()}
          onClick={() => xtermRef.current?.focus()}
          className="h-(--sz-18rem) w-full overflow-hidden bg-neutral-950 outline-none sm:h-(--sz-22rem) [&_.xterm-cursor-bar]:!border-l-2 [&_.xterm-cursor-bar]:!border-l-cyan-300 [&_.xterm-cursor-layer_.xterm-cursor]:!bg-cyan-300 [&_.xterm-helper-textarea]:!opacity-0 [&_.xterm-screen]:focus:outline-none [&_.xterm-viewport]:!overflow-y-auto [&_.xterm]:h-full"
        />
      </div>
      {errorMessage ? (
        <div className="border-t border-border/60 px-3 py-2 text-xs text-destructive">
          {errorMessage}
        </div>
      ) : null}
    </div>
  );
}

function capabilityState(
  capability: EnvironmentProviderCapability | null | undefined,
) {
  if (
    !capability ||
    capability.status !== "supported" ||
    !capability.supportsInteractiveSetup
  ) {
    return {
      kind: "unsupported" as const,
      labelKey: "companySettings.customImage.unsupportedProvider",
      labelDefault: "Unsupported provider",
      reasonKey: "companySettings.customImage.unsupportedProviderReason",
      reasonDefault:
        "This provider does not advertise interactive template setup.",
    };
  }

  if (!capability.supportsTemplateCapture) {
    return {
      kind: "capture_unavailable" as const,
      labelKey: "companySettings.customImage.captureUnavailable",
      labelDefault: "Setup capture unavailable",
      reasonKey: "companySettings.customImage.captureUnavailableReason",
      reasonDefault:
        "This provider advertises setup, but image capture is unavailable.",
    };
  }

  return {
    kind: "supported" as const,
    labelKey: "companySettings.customImage.templateSetup",
    labelDefault: "Template setup",
    reasonKey: null,
    reasonDefault: null,
  };
}

function sessionStatusCopy(
  status: EnvironmentCustomImageSetupSession["status"],
) {
  switch (status) {
    case "starting":
      return {
        key: "companySettings.customImage.status.starting",
        defaultValue: "Setup starting",
      };
    case "waiting_for_user":
      return {
        key: "companySettings.customImage.status.waitingForUser",
        defaultValue: "Setup running",
      };
    case "capturing":
      return {
        key: "companySettings.customImage.status.capturing",
        defaultValue: "Capturing template",
      };
    case "promoted":
      return {
        key: "companySettings.customImage.status.promoted",
        defaultValue: "Template captured",
      };
    case "cancelled":
      return {
        key: "companySettings.customImage.status.cancelled",
        defaultValue: "Setup cancelled",
      };
    case "timed_out":
      return {
        key: "companySettings.customImage.status.timedOut",
        defaultValue: "Setup expired",
      };
    case "failed":
      return {
        key: "companySettings.customImage.status.failed",
        defaultValue: "Setup failed",
      };
    default:
      return {
        key: "companySettings.customImage.status.unknown",
        defaultValue: "Setup status",
      };
  }
}

function EnvironmentImageTemplatePanel({
  environment,
  companyId,
  providerCapability,
  providerDisplayName,
}: {
  environment: Environment;
  companyId: string;
  providerCapability: EnvironmentProviderCapability | null | undefined;
  providerDisplayName: string;
}) {
  const { t } = useTranslation();
  const { pushToast } = useToast();
  const queryClient = useQueryClient();
  const state = capabilityState(providerCapability);
  const overviewKey = queryKeys.environments.customImageTemplate(
    environment.id,
  );
  const stateLabel = t(state.labelKey, { defaultValue: state.labelDefault });
  const stateReason =
    state.reasonKey && state.reasonDefault
      ? t(state.reasonKey, { defaultValue: state.reasonDefault })
      : null;
  const sessionStatusText = (
    status: EnvironmentCustomImageSetupSession["status"],
  ) => {
    const copy = sessionStatusCopy(status);
    return t(copy.key, { defaultValue: copy.defaultValue });
  };

  const overviewQuery = useQuery({
    queryKey: overviewKey,
    queryFn: () =>
      environmentsApi.customImageTemplate(environment.id, companyId),
    enabled: state.kind === "supported",
    retry: false,
  });

  const activeSessionId = overviewQuery.data?.activeSession?.id ?? null;
  const sessionQuery = useQuery({
    queryKey: activeSessionId
      ? queryKeys.environments.customImageSetupSession(activeSessionId)
      : ["environment-custom-image-setup-sessions", "none", environment.id],
    queryFn: () => environmentsApi.customImageSetupSession(activeSessionId!),
    enabled: Boolean(
      activeSessionId &&
        isActiveCustomImageSetupSession(overviewQuery.data?.activeSession),
    ),
    retry: false,
  });

  function setSessionResult(result: EnvironmentCustomImageSetupSessionResult) {
    queryClient.setQueryData(
      queryKeys.environments.customImageSetupSession(result.session.id),
      result,
    );
  }

  function invalidateOverview() {
    void queryClient.invalidateQueries({ queryKey: overviewKey });
  }

  const startSetupMutation = useMutation({
    mutationFn: (input: { templateId?: string | null } = {}) =>
      environmentsApi.startCustomImageSetupSession(environment.id, companyId, {
        templateId: input.templateId ?? null,
      }),
    onSuccess: (result) => {
      queryClient.setQueryData(
        overviewKey,
        (current: typeof overviewQuery.data) => ({
          activeTemplate: current?.activeTemplate ?? null,
          activeSession: result.session,
          latestSession: result.session,
        }),
      );
      setSessionResult(result);
      pushToast({
        title: t("companySettings.customImage.setupStartedTitle", {
          defaultValue: "Setup session started",
        }),
        body: t("companySettings.customImage.setupStartedBody", {
          defaultValue:
            "Connect details are available while the session is active.",
        }),
        tone: "success",
      });
    },
    onError: (error) => {
      pushToast({
        title: t("companySettings.customImage.setupStartFailedTitle", {
          defaultValue: "Failed to start setup",
        }),
        body:
          error instanceof Error
            ? error.message
            : t("companySettings.customImage.setupStartFailedBody", {
                defaultValue: "Setup session could not be started.",
              }),
        tone: "error",
      });
    },
  });

  const finishSetupMutation = useMutation({
    mutationFn: (sessionId: string) =>
      environmentsApi.finishCustomImageSetupSession(sessionId, {}),
    onSuccess: (result) => {
      queryClient.setQueryData(overviewKey, {
        activeTemplate: result.template,
        activeSession: null,
        latestSession: result.session,
      });
      setSessionResult({ session: result.session, connectionPayload: null });
      invalidateOverview();
      pushToast({
        title: t("companySettings.customImage.templateCapturedTitle", {
          defaultValue: "Template captured",
        }),
        body: t("companySettings.customImage.templateCapturedBody", {
          defaultValue: "Future runs can use the promoted template.",
        }),
        tone: "success",
      });
    },
    onError: (error) => {
      pushToast({
        title: t("companySettings.customImage.templateCaptureFailedTitle", {
          defaultValue: "Failed to capture template",
        }),
        body:
          error instanceof Error
            ? error.message
            : t("companySettings.customImage.templateCaptureFailedBody", {
                defaultValue: "Template capture failed.",
              }),
        tone: "error",
      });
    },
  });

  const cancelSetupMutation = useMutation({
    mutationFn: (sessionId: string) =>
      environmentsApi.cancelCustomImageSetupSession(sessionId, {
        reason: "operator cancelled",
      }),
    onSuccess: (session) => {
      queryClient.setQueryData(
        overviewKey,
        (current: typeof overviewQuery.data) => ({
          activeTemplate: current?.activeTemplate ?? null,
          activeSession: null,
          latestSession: session,
        }),
      );
      setSessionResult({ session, connectionPayload: null });
      invalidateOverview();
      pushToast({
        title: t("companySettings.customImage.setupCancelledTitle", {
          defaultValue: "Setup cancelled",
        }),
        body: t("companySettings.customImage.setupCancelledBody", {
          defaultValue: "The active template was not changed.",
        }),
        tone: "success",
      });
    },
    onError: (error) => {
      pushToast({
        title: t("companySettings.customImage.setupCancelFailedTitle", {
          defaultValue: "Failed to cancel setup",
        }),
        body:
          error instanceof Error
            ? error.message
            : t("companySettings.customImage.setupCancelFailedBody", {
                defaultValue: "Setup session could not be cancelled.",
              }),
        tone: "error",
      });
    },
  });

  const rollbackTemplateMutation = useMutation({
    mutationFn: () =>
      environmentsApi.rollbackCustomImageTemplate(environment.id, companyId),
    onSuccess: (result) => {
      queryClient.setQueryData(
        overviewKey,
        (current: typeof overviewQuery.data) => ({
          activeTemplate: result.activeTemplate,
          activeSession: null,
          latestSession: current?.latestSession ?? null,
        }),
      );
      invalidateOverview();
      pushToast({
        title: t("companySettings.customImage.templateRolledBackTitle", {
          defaultValue: "Template rolled back",
        }),
        body: t("companySettings.customImage.templateRolledBackBody", {
          defaultValue: "Future runs will use the previous template.",
        }),
        tone: "success",
      });
    },
    onError: (error) => {
      pushToast({
        title: t("companySettings.customImage.templateRollbackFailedTitle", {
          defaultValue: "Failed to roll back template",
        }),
        body:
          error instanceof Error
            ? error.message
            : t("companySettings.customImage.templateRollbackFailedBody", {
                defaultValue: "Rollback failed.",
              }),
        tone: "error",
      });
    },
  });

  const disableTemplateMutation = useMutation({
    mutationFn: () =>
      environmentsApi.disableCustomImageTemplate(environment.id, companyId),
    onSuccess: (template) => {
      queryClient.setQueryData(
        overviewKey,
        (current: typeof overviewQuery.data) => ({
          activeTemplate: null,
          activeSession: null,
          latestSession: current?.latestSession ?? null,
        }),
      );
      invalidateOverview();
      pushToast({
        title: t("companySettings.customImage.templateDisabledTitle", {
          defaultValue: "Template disabled",
        }),
        body: t("companySettings.customImage.templateDisabledBody", {
          defaultValue: "Future runs will use the base provider configuration.",
        }),
        tone: "success",
      });
    },
    onError: (error) => {
      pushToast({
        title: t("companySettings.customImage.templateDisableFailedTitle", {
          defaultValue: "Failed to disable template",
        }),
        body:
          error instanceof Error
            ? error.message
            : t("companySettings.customImage.templateDisableFailedBody", {
                defaultValue: "Disable failed.",
              }),
        tone: "error",
      });
    },
  });

  if (state.kind !== "supported") {
    return (
      <div
        className="mt-3 border-t border-border/60 pt-3 text-xs"
        data-testid={`custom-image-template-state-${environment.id}`}
      >
        <div className="font-medium text-foreground">{stateLabel}</div>
        <div className="mt-1 text-muted-foreground">{stateReason}</div>
      </div>
    );
  }

  if (overviewQuery.isLoading) {
    return (
      <div className="mt-3 border-t border-border/60 pt-3 text-xs text-muted-foreground">
        {t("companySettings.customImage.loading", {
          defaultValue: "Loading template setup...",
        })}
      </div>
    );
  }

  if (overviewQuery.isError) {
    return (
      <div className="mt-3 border-t border-border/60 pt-3 text-xs text-destructive">
        {overviewQuery.error instanceof Error
          ? overviewQuery.error.message
          : t("companySettings.customImage.loadFailed", {
              defaultValue: "Template setup could not be loaded.",
            })}
      </div>
    );
  }

  const overview = overviewQuery.data;
  const activeTemplate = overview?.activeTemplate ?? null;
  const refreshedSession = sessionQuery.data?.session ?? null;
  const session = refreshedSession ?? overview?.activeSession ?? null;
  const latestSession = !isActiveCustomImageSetupSession(session)
    ? (session ?? overview?.latestSession ?? null)
    : (overview?.latestSession ?? null);
  const connectionPayload =
    session?.status === "waiting_for_user"
      ? (sessionQuery.data?.connectionPayload ?? null)
      : null;
  const connectionCommand = readConnectionCommand(connectionPayload);
  const connectionFallbackMessage =
    session?.status === "waiting_for_user"
      ? setupConnectionFallbackMessage({
          payload: connectionPayload,
          refreshError: sessionQuery.isError ? sessionQuery.error : null,
          isLoading: sessionQuery.isLoading,
        })
      : null;
  const sessionExpiresAt = formatDateTime(
    connectionPayload?.expiresAt ?? session?.expiresAt ?? null,
  );
  const capturedAt = formatDateTime(
    activeTemplate?.capturedAt ?? activeTemplate?.createdAt ?? null,
  );
  const lastUsedAt = formatDateTime(activeTemplate?.lastUsedAt ?? null);
  const isMutating =
    startSetupMutation.isPending ||
    finishSetupMutation.isPending ||
    cancelSetupMutation.isPending ||
    rollbackTemplateMutation.isPending ||
    disableTemplateMutation.isPending;

  if (session && isActiveCustomImageSetupSession(session)) {
    const isCapturing = session.status === "capturing";
    return (
      <div
        className="mt-3 border-t border-border/60 pt-3"
        data-testid={`custom-image-template-state-${environment.id}`}
      >
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0 space-y-1">
            <div className="text-xs font-medium">
              {sessionStatusText(session.status)}
            </div>
            <div className="text-xs text-muted-foreground">
              {providerDisplayName}
              {sessionExpiresAt
                ? t("companySettings.customImage.expiresAt", {
                    defaultValue: " · expires {{time}}",
                    time: sessionExpiresAt,
                  })
                : ""}
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Button
              size="sm"
              variant="outline"
              onClick={() => finishSetupMutation.mutate(session.id)}
              disabled={isMutating || session.status !== "waiting_for_user"}
            >
              <Check className="mr-1.5 h-3.5 w-3.5" />
              {t("companySettings.customImage.finished", {
                defaultValue: "Finished",
              })}
            </Button>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => cancelSetupMutation.mutate(session.id)}
              disabled={isMutating}
            >
              <X className="mr-1.5 h-3.5 w-3.5" />
              {t("Cancel", { defaultValue: "Cancel" })}
            </Button>
          </div>
        </div>
        {isCapturing ? (
          <div className="mt-2 text-xs text-muted-foreground">
            {t("companyEnvironments.captureInProgress")}
          </div>
        ) : null}
        {session.status === "waiting_for_user" &&
        connectionPayload?.type === "ssh" ? (
          <EnvironmentCustomImageBrowserTerminal
            autoConnect
            sessionId={session.id}
          />
        ) : null}
        {session.status === "waiting_for_user" && connectionCommand ? (
          <details className="mt-2 rounded-md border border-border/60 bg-muted/20 px-3 py-2 text-xs text-muted-foreground">
            <summary className="cursor-pointer select-none font-medium text-foreground">
              {t("companyEnvironments.sshFallback")}
            </summary>
            <code className="mt-2 block overflow-x-auto whitespace-nowrap text-(length:--text-micro) leading-5">
              {connectionCommand}
            </code>
          </details>
        ) : null}
        {session.status === "waiting_for_user" && connectionFallbackMessage ? (
          <div className="mt-2 text-xs text-muted-foreground">
            {connectionFallbackMessage}
          </div>
        ) : null}
        {session.failureReason ? (
          <div className="mt-2 text-xs text-destructive">
            {session.failureReason}
          </div>
        ) : null}
      </div>
    );
  }

  if (activeTemplate) {
    const templateRef = activeTemplate.templateRef?.trim() || null;
    const templateOutOfSync = overview?.activeTemplateMatchesConfig === false;
    return (
      <div
        className="mt-3 border-t border-border/60 pt-3"
        data-testid={`custom-image-template-state-${environment.id}`}
      >
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0 space-y-1">
            <div className="text-xs font-medium">
              {t("companySettings.customImage.activeTemplate", {
                defaultValue: "Active template",
              })}
            </div>
            <div className="text-xs text-muted-foreground">
              {providerDisplayName} · {activeTemplate.templateKind}
              {" · "}
              <span
                className="break-all font-mono text-foreground"
                title={
                  templateRef
                    ? `Provider ${activeTemplate.templateKind} ref ${templateRef} (Paperclip template ${activeTemplate.id})`
                    : activeTemplate.id
                }
              >
                {templateRef ?? `id ${formatShortId(activeTemplate.id)}`}
              </span>
              {capturedAt
                ? t("companySettings.customImage.capturedAt", {
                    defaultValue: " · captured {{time}}",
                    time: capturedAt,
                  })
                : ""}
              {lastUsedAt
                ? t("companySettings.customImage.lastUsedAt", {
                    defaultValue: " · last used {{time}}",
                    time: lastUsedAt,
                  })
                : ""}
            </div>
            {templateOutOfSync ? (
              <div
                className="text-xs text-destructive"
                data-testid={`custom-image-template-out-of-sync-${environment.id}`}
              >
                {t("companyEnvironments.imageStale")}
              </div>
            ) : null}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Button
              size="sm"
              variant="outline"
              onClick={() =>
                startSetupMutation.mutate({ templateId: activeTemplate.id })
              }
              disabled={isMutating}
            >
              <RefreshCw className="mr-1.5 h-3.5 w-3.5" />
              {t("Refresh", { defaultValue: "Refresh" })}
            </Button>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => rollbackTemplateMutation.mutate()}
              disabled={isMutating}
            >
              <RotateCcw className="mr-1.5 h-3.5 w-3.5" />
              {t("companySettings.customImage.rollback", {
                defaultValue: "Rollback",
              })}
            </Button>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => disableTemplateMutation.mutate()}
              disabled={isMutating}
            >
              <Trash2 className="mr-1.5 h-3.5 w-3.5" />
              {t("companySettings.customImage.disable", {
                defaultValue: "Disable",
              })}
            </Button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div
      className="mt-3 border-t border-border/60 pt-3"
      data-testid={`custom-image-template-state-${environment.id}`}
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="space-y-1">
          <div className="text-xs font-medium">
            {t("companySettings.customImage.notConfigured", {
              defaultValue: "Not configured",
            })}
          </div>
          <div className="text-xs text-muted-foreground">
            {latestSession
              ? sessionStatusText(latestSession.status)
              : t("companySettings.customImage.captureDescription", {
                  defaultValue:
                    "Capture a custom {{provider}} image with your tools already logged in.",
                  provider: providerDisplayName,
                })}
          </div>
          {latestSession?.failureReason ? (
            <div className="text-xs text-destructive">
              {latestSession.failureReason}
            </div>
          ) : null}
        </div>
        <Button
          size="sm"
          variant="outline"
          onClick={() => startSetupMutation.mutate({ templateId: null })}
          disabled={isMutating}
        >
          <Play className="mr-1.5 h-3.5 w-3.5" />
          {t("companySettings.customImage.configureImage", {
            defaultValue: "Configure image",
          })}
        </Button>
      </div>
    </div>
  );
}

export function CompanyEnvironments({
  mode = "list",
}: CompanyEnvironmentsProps) {
  const { environmentId: routeEnvironmentId } = useParams<{
    environmentId?: string;
  }>();
  const navigate = useNavigate();
  const { selectedCompanyId } = useCompany();
  const { setBreadcrumbs } = useBreadcrumbs();
  const { pushToast } = useToast();
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const isEnvironmentFormPage = mode === "create" || mode === "edit";
  const editingEnvironmentId =
    mode === "edit" ? (routeEnvironmentId ?? null) : null;
  const [environmentForm, setEnvironmentForm] = useState<EnvironmentFormState>(
    createEmptyEnvironmentForm,
  );
  const environmentVariablesEditorRef =
    useRef<EnvironmentVariablesEditorHandle | null>(null);
  const initializedFormKeyRef = useRef<string | null>(null);
  // Fingerprint of the form as initialized; null until the form page has loaded its data.
  const [environmentFormBaselineKey, setEnvironmentFormBaselineKey] = useState<
    string | null
  >(null);
  const [environmentVariablesDirty, setEnvironmentVariablesDirty] =
    useState(false);
  const [probeResults, setProbeResults] = useState<
    Record<string, EnvironmentProbeResult | null>
  >({});
  const [testingEnvironmentId, setTestingEnvironmentId] = useState<
    string | null
  >(null);
  const environmentHasUnsavedChanges =
    isEnvironmentFormPage &&
    (environmentVariablesDirty ||
      (environmentFormBaselineKey !== null &&
        environmentFormKey(environmentForm) !== environmentFormBaselineKey));

  useEffect(() => {
    setBreadcrumbs([
      {
        label: t("Settings", { defaultValue: "Settings" }),
        href: "/company/settings",
      },
      {
        label: t("Instance settings", { defaultValue: "Instance settings" }),
        href: "/company/settings/instance/general",
      },
      {
        label: t("companySettings.environments", {
          defaultValue: "Environments",
        }),
      },
    ]);
  }, [setBreadcrumbs, t]);

  const { data: instanceSettings } = useQuery({
    queryKey: queryKeys.instance.settings,
    queryFn: () => instanceSettingsApi.get(),
    retry: false,
  });

  const { data: experimentalSettings } = useQuery({
    queryKey: queryKeys.instance.experimentalSettings,
    queryFn: () => instanceSettingsApi.getExperimental(),
    retry: false,
  });
  const environmentsEnabled = experimentalSettings?.enableEnvironments === true;

  const { data: environments } = useQuery({
    queryKey: selectedCompanyId
      ? queryKeys.environments.list(selectedCompanyId)
      : ["environments", "none"],
    queryFn: () => environmentsApi.list(selectedCompanyId!),
    enabled: Boolean(selectedCompanyId) && environmentsEnabled,
  });
  const savedEnvironments = environments ?? [];
  // Descriptors for the edited environment's secret refs. Environments are
  // instance-scoped while secrets are company-scoped, so a ref may point at
  // a secret this company's picker cannot list; these hints let the picker
  // name it instead of calling it missing.
  const environmentSecretRefsQuery = useQuery({
    queryKey: editingEnvironmentId
      ? ["environment-secret-refs", editingEnvironmentId]
      : ["environment-secret-refs", "none"],
    queryFn: () => environmentsApi.secretRefs(editingEnvironmentId!),
    enabled: Boolean(editingEnvironmentId) && environmentsEnabled,
    retry: false,
  });
  const environmentSecretRefHints = useMemo<SecretRefHintsContextValue>(() => {
    // A new environment has no persisted refs, so the empty map is
    // authoritative. For an existing environment the map is only "ready"
    // once the descriptor request resolved — the picker must not call a
    // reference missing off a pending or failed lookup.
    if (!editingEnvironmentId) return { status: "ready", hints: {} };
    if (environmentSecretRefsQuery.isError)
      return { status: "error", hints: {} };
    if (!environmentSecretRefsQuery.data)
      return { status: "loading", hints: {} };
    const hints: Record<string, SecretRefHint> = {};
    for (const ref of environmentSecretRefsQuery.data.refs) {
      hints[ref.secretId] = {
        name: ref.name,
        status: ref.status,
        companyId: ref.companyId,
        companyName: ref.companyName,
      };
    }
    return { status: "ready", hints };
  }, [
    editingEnvironmentId,
    environmentSecretRefsQuery.data,
    environmentSecretRefsQuery.isError,
  ]);
  const { data: environmentCapabilities } = useQuery({
    queryKey: selectedCompanyId
      ? ["environment-capabilities", selectedCompanyId]
      : ["environment-capabilities", "none"],
    queryFn: () => environmentsApi.capabilities(selectedCompanyId!),
    enabled: Boolean(selectedCompanyId) && environmentsEnabled,
  });

  const { data: secrets } = useQuery({
    queryKey: selectedCompanyId
      ? ["company-secrets", selectedCompanyId]
      : ["company-secrets", "none"],
    queryFn: () => secretsApi.list(selectedCompanyId!),
    enabled: Boolean(selectedCompanyId),
  });
  const createSecret = useMutation({
    mutationFn: (input: { name: string; value: string }) => {
      if (!selectedCompanyId) {
        throw new Error(
          t("agentConfig.selectCompanyToCreateSecrets", {
            defaultValue: "Select a company before creating secrets.",
          }),
        );
      }
      return secretsApi.create(selectedCompanyId, input);
    },
    onSuccess: async () => {
      if (!selectedCompanyId) return;
      await queryClient.invalidateQueries({
        queryKey: queryKeys.secrets.list(selectedCompanyId),
      });
      await queryClient.invalidateQueries({
        queryKey: ["company-secrets", selectedCompanyId],
      });
    },
  });

  const environmentMutation = useMutation({
    mutationFn: async (form: EnvironmentFormState) => {
      const body = buildEnvironmentPayload(form);

      if (editingEnvironmentId) {
        return await environmentsApi.update(editingEnvironmentId, body);
      }

      if (!selectedCompanyId)
        throw new Error("Select a company to create environments");
      return await environmentsApi.create(selectedCompanyId!, body);
    },
    onSuccess: async (environment) => {
      const wasEditing = editingEnvironmentId !== null;
      if (selectedCompanyId) {
        await queryClient.invalidateQueries({
          queryKey: queryKeys.environments.list(selectedCompanyId),
        });
      }
      await queryClient.invalidateQueries({
        queryKey: queryKeys.environments.customImageTemplate(environment.id),
      });
      initializedFormKeyRef.current = null;
      setEnvironmentForm(createEmptyEnvironmentForm());
      setEnvironmentFormBaselineKey(null);
      setEnvironmentVariablesDirty(false);
      environmentMutation.reset();
      draftEnvironmentProbeMutation.reset();
      navigate(ENVIRONMENTS_PATH, { replace: true });
      pushToast({
        title: wasEditing
          ? t("companySettings.environmentUpdated")
          : t("companySettings.environmentCreated"),
        body: t("companySettings.environmentReady", { name: environment.name }),
        tone: "success",
      });
      const reconciliation = (environment as EnvironmentUpdateResult)
        .customImageReconciliation;
      if (reconciliation?.action === "relinked") {
        pushToast({
          title: "Custom image kept active",
          body: "The captured image was re-linked to the updated configuration automatically.",
          tone: "info",
        });
      } else if (reconciliation?.action === "detached") {
        pushToast({
          title: "Custom image no longer applies",
          body: "This change alters what the captured image was built from. Runs use the base configuration until you capture a new image.",
          tone: "warn",
        });
      }
    },
    onError: (error) => {
      pushToast({
        title: t("companySettings.failedToSaveEnvironment"),
        body:
          error instanceof Error
            ? error.message
            : t("companySettings.environmentSaveFailed"),
        tone: "error",
      });
    },
  });

  const defaultEnvironmentMutation = useMutation({
    mutationFn: async (defaultEnvironmentId: string | null) =>
      await instanceSettingsApi.update({ defaultEnvironmentId }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({
        queryKey: queryKeys.instance.settings,
      });
      pushToast({
        title: t("companySettings.defaultEnvironmentUpdated", {
          defaultValue: "Default environment updated",
        }),
        body: t("companySettings.defaultEnvironmentUpdatedBody", {
          defaultValue:
            "Agent inheritance now follows the updated instance default.",
        }),
        tone: "success",
      });
    },
    onError: (error) => {
      pushToast({
        title: t("companySettings.defaultEnvironmentUpdateFailed", {
          defaultValue: "Failed to update default environment",
        }),
        body:
          error instanceof Error
            ? error.message
            : t("companySettings.defaultEnvironmentUpdateFailedBody", {
                defaultValue: "Default environment update failed.",
              }),
        tone: "error",
      });
    },
  });

  const environmentProbeMutation = useMutation({
    mutationFn: async (environmentId: string) =>
      await environmentsApi.probe(environmentId, selectedCompanyId),
    onMutate: (environmentId) => {
      setTestingEnvironmentId(environmentId);
    },
    onSettled: (_probe, _error, environmentId) => {
      setTestingEnvironmentId((current) =>
        current === environmentId ? null : current,
      );
    },
    onSuccess: (probe, environmentId) => {
      setProbeResults((current) => ({
        ...current,
        [environmentId]: probe,
      }));
      pushToast({
        title: probe.ok
          ? t("companySettings.environmentProbePassed")
          : t("companySettings.environmentProbeFailed"),
        body: probe.summary,
        tone: probe.ok ? "success" : "error",
      });
    },
    onError: (error, environmentId) => {
      const failedEnvironment = (environments ?? []).find(
        (environment) => environment.id === environmentId,
      );
      setProbeResults((current) => ({
        ...current,
        [environmentId]: {
          ok: false,
          driver: failedEnvironment?.driver ?? "local",
          summary:
            error instanceof Error
              ? error.message
              : t("companySettings.environmentProbeFailedSentence"),
          details: null,
        },
      }));
      pushToast({
        title: t("companySettings.environmentProbeFailed"),
        body:
          error instanceof Error
            ? error.message
            : t("companySettings.environmentProbeFailedSentence"),
        tone: "error",
      });
    },
  });

  const draftEnvironmentProbeMutation = useMutation({
    mutationFn: async (form: EnvironmentFormState) => {
      if (!selectedCompanyId)
        throw new Error("Select a company to test environments");
      const body = buildEnvironmentPayload(form);
      return await environmentsApi.probeConfig(selectedCompanyId, body);
    },
    onSuccess: (probe) => {
      pushToast({
        title: probe.ok
          ? t("companySettings.draftProbePassed")
          : t("companySettings.draftProbeFailed"),
        body: probe.summary,
        tone: probe.ok ? "success" : "error",
      });
    },
    onError: (error) => {
      pushToast({
        title: t("companySettings.draftProbeFailed"),
        body:
          error instanceof Error
            ? error.message
            : t("companySettings.environmentProbeFailedSentence"),
        tone: "error",
      });
    },
  });

  useEffect(() => {
    initializedFormKeyRef.current = null;
    setEnvironmentForm(createEmptyEnvironmentForm());
    setEnvironmentFormBaselineKey(null);
    setEnvironmentVariablesDirty(false);
    setProbeResults({});
    setTestingEnvironmentId(null);
  }, [selectedCompanyId]);

  const resetEnvironmentMutation = environmentMutation.reset;
  const resetDraftEnvironmentProbeMutation =
    draftEnvironmentProbeMutation.reset;

  useEffect(() => {
    if (!isEnvironmentFormPage) {
      initializedFormKeyRef.current = null;
      setEnvironmentFormBaselineKey(null);
      setEnvironmentVariablesDirty(false);
      return;
    }

    const formKey =
      mode === "create"
        ? `create:${selectedCompanyId ?? "none"}`
        : `edit:${selectedCompanyId ?? "none"}:${editingEnvironmentId ?? "missing"}`;

    if (initializedFormKeyRef.current === formKey) return;

    resetEnvironmentMutation();
    resetDraftEnvironmentProbeMutation();

    if (mode === "create") {
      const emptyForm = createEmptyEnvironmentForm();
      setEnvironmentForm(emptyForm);
      setEnvironmentFormBaselineKey(environmentFormKey(emptyForm));
      setEnvironmentVariablesDirty(false);
      initializedFormKeyRef.current = formKey;
      return;
    }

    const environment = editingEnvironmentId
      ? ((environments ?? []).find(
          (candidate) => candidate.id === editingEnvironmentId,
        ) ?? null)
      : null;
    if (!environment) return;

    const nextForm = createEnvironmentFormFromEnvironment(environment);
    setEnvironmentForm(nextForm);
    setEnvironmentFormBaselineKey(environmentFormKey(nextForm));
    setEnvironmentVariablesDirty(false);
    initializedFormKeyRef.current = formKey;
  }, [
    editingEnvironmentId,
    environments,
    isEnvironmentFormPage,
    mode,
    resetDraftEnvironmentProbeMutation,
    resetEnvironmentMutation,
    selectedCompanyId,
  ]);

  function confirmDiscardEnvironmentChanges() {
    return (
      !environmentHasUnsavedChanges ||
      typeof window === "undefined" ||
      window.confirm(DISCARD_ENVIRONMENT_CHANGES_MESSAGE)
    );
  }

  // The form page is routed, so leaving it (tab close, reload, or an in-app
  // link) silently drops the draft. Intercept both exits while dirty.
  useEffect(() => {
    if (!environmentHasUnsavedChanges) return;

    function handleBeforeUnload(event: BeforeUnloadEvent) {
      event.preventDefault();
      event.returnValue = "";
    }

    function handleDocumentClick(event: MouseEvent) {
      if (
        event.defaultPrevented ||
        event.button !== 0 ||
        event.altKey ||
        event.ctrlKey ||
        event.metaKey ||
        event.shiftKey
      ) {
        return;
      }
      const target = event.target;
      if (!(target instanceof Element)) return;
      const anchor = target.closest("a[href]");
      if (!(anchor instanceof HTMLAnchorElement)) return;
      if (anchor.target && anchor.target !== "_self") return;

      const nextUrl = new URL(anchor.href, window.location.href);
      const currentUrl = new URL(window.location.href);
      if (nextUrl.origin !== currentUrl.origin) return;
      if (
        nextUrl.pathname === currentUrl.pathname &&
        nextUrl.search === currentUrl.search &&
        nextUrl.hash === currentUrl.hash
      ) {
        return;
      }

      if (window.confirm(DISCARD_ENVIRONMENT_CHANGES_MESSAGE)) return;
      event.preventDefault();
      event.stopPropagation();
    }

    window.addEventListener("beforeunload", handleBeforeUnload);
    document.addEventListener("click", handleDocumentClick, true);
    return () => {
      window.removeEventListener("beforeunload", handleBeforeUnload);
      document.removeEventListener("click", handleDocumentClick, true);
    };
  }, [environmentHasUnsavedChanges]);

  function closeEnvironmentForm() {
    if (environmentMutation.isPending) return;
    if (!confirmDiscardEnvironmentChanges()) return;
    initializedFormKeyRef.current = null;
    setEnvironmentForm(createEmptyEnvironmentForm());
    setEnvironmentFormBaselineKey(null);
    setEnvironmentVariablesDirty(false);
    environmentMutation.reset();
    draftEnvironmentProbeMutation.reset();
    navigate(ENVIRONMENTS_PATH);
  }

  function flushEnvironmentForm(): EnvironmentFormState {
    const flushedEnvVars =
      environmentVariablesEditorRef.current?.flushPendingDraft();
    return flushedEnvVars
      ? { ...environmentForm, envVars: flushedEnvVars }
      : environmentForm;
  }

  const discoveredPluginSandboxProviders = Object.entries(
    environmentCapabilities?.sandboxProviders ?? {},
  )
    .filter(
      ([provider, capability]) =>
        provider !== "fake" && capability.supportsRunExecution,
    )
    .map(([provider, capability]) => ({
      provider,
      displayName: capability.displayName || provider,
      description: capability.description,
      configSchema: normalizeJsonSchema(capability.configSchema),
    }))
    .sort((left, right) => left.displayName.localeCompare(right.displayName));
  const sandboxCreationEnabled = discoveredPluginSandboxProviders.length > 0;
  const pluginSandboxProviders =
    environmentForm.sandboxProvider.trim().length > 0 &&
    environmentForm.sandboxProvider !== "fake" &&
    !discoveredPluginSandboxProviders.some(
      (provider) => provider.provider === environmentForm.sandboxProvider,
    )
      ? [
          ...discoveredPluginSandboxProviders,
          {
            provider: environmentForm.sandboxProvider,
            displayName: environmentForm.sandboxProvider,
            description: undefined,
            configSchema: null,
          },
        ]
      : discoveredPluginSandboxProviders;

  const selectedSandboxProvider =
    pluginSandboxProviders.find(
      (provider) => provider.provider === environmentForm.sandboxProvider,
    ) ?? null;
  const selectedSandboxSchema = selectedSandboxProvider?.configSchema ?? null;
  const sandboxConfigErrors =
    environmentForm.driver === "sandbox" && selectedSandboxSchema
      ? validateJsonSchemaForm(
          selectedSandboxSchema as any,
          environmentForm.sandboxConfig,
        )
      : {};

  useEffect(() => {
    if (environmentForm.driver !== "sandbox") return;
    if (
      environmentForm.sandboxProvider.trim().length > 0 &&
      environmentForm.sandboxProvider !== "fake"
    )
      return;
    const firstProvider = discoveredPluginSandboxProviders[0]?.provider;
    if (!firstProvider) return;
    const firstSchema = discoveredPluginSandboxProviders[0]?.configSchema;
    setEnvironmentForm((current) =>
      current.driver !== "sandbox" ||
      (current.sandboxProvider.trim().length > 0 &&
        current.sandboxProvider !== "fake")
        ? current
        : {
            ...current,
            sandboxProvider: firstProvider,
            sandboxConfig: firstSchema
              ? getDefaultValues(firstSchema as any)
              : {},
          },
    );
  }, [
    discoveredPluginSandboxProviders,
    environmentForm.driver,
    environmentForm.sandboxProvider,
  ]);

  const environmentFormValid =
    environmentForm.name.trim().length > 0 &&
    (environmentForm.driver !== "ssh" ||
      (environmentForm.sshHost.trim().length > 0 &&
        environmentForm.sshUsername.trim().length > 0 &&
        environmentForm.sshRemoteWorkspacePath.trim().length > 0)) &&
    (environmentForm.driver !== "sandbox" ||
      (environmentForm.sandboxProvider.trim().length > 0 &&
        environmentForm.sandboxProvider !== "fake" &&
        Object.keys(sandboxConfigErrors).length === 0));

  const editingEnvironment = editingEnvironmentId
    ? (savedEnvironments.find(
        (environment) => environment.id === editingEnvironmentId,
      ) ?? null)
    : null;
  const editingSandboxProvider = editingEnvironment
    ? readEnvironmentSandboxProvider(editingEnvironment)
    : null;
  const editingSandboxCapability = editingSandboxProvider
    ? environmentCapabilities?.sandboxProviders?.[editingSandboxProvider]
    : null;
  const editingSandboxDisplayName =
    editingSandboxCapability?.displayName ??
    editingSandboxProvider ??
    "sandbox";
  const nonLocalEnvironments = savedEnvironments.filter(
    (environment) => !isLocalEnvironment(environment),
  );
  const instanceDefaultEnvironmentId = normalizeNonLocalEnvironmentId(
    instanceSettings?.defaultEnvironmentId ?? null,
    savedEnvironments,
  );

  if (!selectedCompanyId) {
    return (
      <div className="text-sm text-muted-foreground">
        {t("companySettings.environmentsSelectCompany", {
          defaultValue:
            "Select a company context to manage environment secrets and bindings.",
        })}
      </div>
    );
  }

  if (!environmentsEnabled) {
    return (
      <div className="max-w-3xl space-y-4">
        <div className="rounded-md border border-border px-4 py-4 text-sm text-muted-foreground">
          {t("companySettings.environmentsDisabled", {
            defaultValue:
              "Enable Environments in instance experimental settings to manage shared execution targets.",
          })}
        </div>
      </div>
    );
  }

  return (
    <div
      className="max-w-5xl space-y-6"
      data-testid="instance-settings-environments-section"
    >
      {!isEnvironmentFormPage ? (
        <div className="space-y-4 rounded-md border border-border px-4 py-4">
          <div className="rounded-md border border-border/60 bg-muted/20 px-3 py-3">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="space-y-1">
                <div className="text-sm font-medium">
                  {t("companySettings.defaultEnvironment", {
                    defaultValue: "Default",
                  })}
                </div>
                <div className="text-xs text-muted-foreground">
                  {t("companySettings.defaultEnvironmentHint", {
                    defaultValue:
                      "Agents inherit this execution target unless project, issue, or agent settings choose another.",
                  })}
                </div>
              </div>
              <div className="min-w-(--sz-18rem) flex-1">
                <select
                  className="w-full rounded-md border border-border bg-transparent px-2.5 py-1.5 text-sm outline-none"
                  value={instanceDefaultEnvironmentId}
                  onChange={(event) =>
                    defaultEnvironmentMutation.mutate(
                      event.target.value || null,
                    )
                  }
                  disabled={defaultEnvironmentMutation.isPending}
                >
                  <option value="">
                    {t("Local", { defaultValue: "Local" })}
                  </option>
                  {nonLocalEnvironments.map((environment) => (
                    <option key={environment.id} value={environment.id}>
                      {environment.name} · {environment.driver}
                    </option>
                  ))}
                </select>
              </div>
            </div>
          </div>

          <div className="space-y-3">
            <div className="flex justify-end">
              <Button size="sm" asChild>
                <Link to={`${ENVIRONMENTS_PATH}/new`}>
                  {t("companySettings.addEnvironment", {
                    defaultValue: "Add environment",
                  })}
                </Link>
              </Button>
            </div>
            {savedEnvironments.length === 0 ? (
              <div className="text-sm text-muted-foreground">
                {t("companySettings.noEnvironments")}
              </div>
            ) : (
              savedEnvironments.map((environment) => {
                const probe = probeResults[environment.id] ?? null;
                const sandboxProvider =
                  readEnvironmentSandboxProvider(environment);
                const sandboxProviderCapability = sandboxProvider
                  ? environmentCapabilities?.sandboxProviders?.[sandboxProvider]
                  : null;
                const sandboxProviderDisplayName =
                  sandboxProviderCapability?.displayName ??
                  sandboxProvider ??
                  "sandbox";
                return (
                  <div
                    key={environment.id}
                    className="rounded-md border border-border/70 px-3 py-3"
                  >
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div className="space-y-1">
                        <div className="text-sm font-medium">
                          {environment.name}{" "}
                          <span className="text-muted-foreground">
                            · {environment.driver}
                          </span>
                        </div>
                        {environment.description ? (
                          <div className="text-xs text-muted-foreground">
                            {environment.description}
                          </div>
                        ) : null}
                        {environment.driver === "ssh" ? (
                          <div className="text-xs text-muted-foreground">
                            {typeof environment.config.host === "string"
                              ? environment.config.host
                              : t("companySettings.sshHostFallback")}{" "}
                            ·{" "}
                            {typeof environment.config.username === "string"
                              ? environment.config.username
                              : t("companySettings.sshUserFallback")}
                          </div>
                        ) : environment.driver === "sandbox" ? (
                          <div className="text-xs text-muted-foreground">
                            {(() => {
                              const summary = summarizeSandboxConfig(
                                environment.config as Record<string, unknown>,
                              );
                              return summary
                                ? t("{{name}} sandbox provider · {{summary}}", {
                                    defaultValue:
                                      "{{name}} sandbox provider · {{summary}}",
                                    name: sandboxProviderDisplayName,
                                    summary,
                                  })
                                : t("{{name}} sandbox provider", {
                                    defaultValue: "{{name}} sandbox provider",
                                    name: sandboxProviderDisplayName,
                                  });
                            })()}
                          </div>
                        ) : (
                          <div className="text-xs text-muted-foreground">
                            {t("companySettings.runsOnThisPaperclipHost")}
                          </div>
                        )}
                      </div>
                      <div className="flex flex-wrap items-center gap-2">
                        {environment.driver !== "local" ? (
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() =>
                              environmentProbeMutation.mutate(environment.id)
                            }
                            disabled={testingEnvironmentId === environment.id}
                          >
                            {testingEnvironmentId === environment.id
                              ? t("Testing...", { defaultValue: "Testing..." })
                              : environment.driver === "ssh"
                                ? t("companySettings.testConnection")
                                : t("companySettings.testProvider")}
                          </Button>
                        ) : null}
                        <Button size="sm" variant="ghost" asChild>
                          <Link to={environmentEditPath(environment.id)}>
                            {t("Edit", { defaultValue: "Edit" })}
                          </Link>
                        </Button>
                      </div>
                    </div>
                    {probe ? (
                      <div
                        className={
                          probe.ok
                            ? "mt-3 rounded border border-green-500/30 bg-green-500/5 px-2.5 py-2 text-xs text-green-700"
                            : "mt-3 rounded border border-destructive/30 bg-destructive/5 px-2.5 py-2 text-xs text-destructive"
                        }
                      >
                        <div className="font-medium">{probe.summary}</div>
                        {probe.details?.error &&
                        typeof probe.details.error === "string" ? (
                          <div className="mt-1 font-mono text-(length:--text-micro)">
                            {probe.details.error}
                          </div>
                        ) : null}
                      </div>
                    ) : null}
                  </div>
                );
              })
            )}
          </div>
        </div>
      ) : null}

      {isEnvironmentFormPage &&
      mode === "edit" &&
      environments === undefined ? (
        <div className="rounded-md border border-border px-4 py-4 text-sm text-muted-foreground">
          {t("companySettings.loadingEnvironment", {
            defaultValue: "Loading environment...",
          })}
        </div>
      ) : null}

      {isEnvironmentFormPage &&
      mode === "edit" &&
      environments !== undefined &&
      !editingEnvironment ? (
        <div className="space-y-3 rounded-md border border-border px-4 py-4 text-sm">
          <div className="font-medium">
            {t("companySettings.environmentNotFound", {
              defaultValue: "Environment not found",
            })}
          </div>
          <div className="text-muted-foreground">
            {t("companySettings.environmentNotFoundDescription", {
              defaultValue:
                "The environment may have been removed or is not available in this company.",
            })}
          </div>
          <Button size="sm" variant="outline" asChild>
            <Link to={ENVIRONMENTS_PATH}>
              {t("companySettings.backToEnvironments", {
                defaultValue: "Back to environments",
              })}
            </Link>
          </Button>
        </div>
      ) : null}

      {isEnvironmentFormPage && (mode === "create" || editingEnvironment) ? (
        <SecretRefHintsContext.Provider value={environmentSecretRefHints}>
          <div
            className="rounded-md border border-border bg-background"
            data-testid="environment-form-page"
          >
            <div className="border-b border-border/60 px-6 pb-4 pt-6">
              <div className="mb-4">
                <Button size="sm" variant="ghost" asChild>
                  <Link to={ENVIRONMENTS_PATH}>
                    <ArrowLeft className="mr-1.5 h-3.5 w-3.5" />
                    {t("companySettings.environments", {
                      defaultValue: "Environments",
                    })}
                  </Link>
                </Button>
              </div>
              <h1 className="text-lg font-semibold">
                {editingEnvironmentId
                  ? t("companySettings.editEnvironment", {
                      defaultValue: "Edit environment",
                    })
                  : t("companySettings.addEnvironment", {
                      defaultValue: "Add environment",
                    })}
              </h1>
              <p className="mt-1 max-w-3xl text-sm text-muted-foreground">
                {t("companySettings.environmentDialogDescription", {
                  defaultValue:
                    "Configure a reusable execution target for your agents. Saved changes affect future runs; Paperclip may start fresh sessions or sandbox leases after environment config changes.",
                })}
              </p>
            </div>

            <div className="px-6 py-4">
              <div className="space-y-4">
                <Field
                  label={t("Name", { defaultValue: "Name" })}
                  hint={t("companySettings.environmentNameHint")}
                >
                  <input
                    className="w-full rounded-md border border-border bg-transparent px-2.5 py-1.5 text-sm outline-none"
                    type="text"
                    value={environmentForm.name}
                    onChange={(e) =>
                      setEnvironmentForm((current) => ({
                        ...current,
                        name: e.target.value,
                      }))
                    }
                  />
                </Field>
                <Field
                  label={t("Description", { defaultValue: "Description" })}
                  hint={t("companySettings.environmentDescriptionHint")}
                >
                  <input
                    className="w-full rounded-md border border-border bg-transparent px-2.5 py-1.5 text-sm outline-none"
                    type="text"
                    value={environmentForm.description}
                    onChange={(e) =>
                      setEnvironmentForm((current) => ({
                        ...current,
                        description: e.target.value,
                      }))
                    }
                  />
                </Field>
                <Field
                  label={t("companySettings.driver")}
                  hint={t("companySettings.environmentDriverHint")}
                >
                  <select
                    className="w-full rounded-md border border-border bg-transparent px-2.5 py-1.5 text-sm outline-none"
                    value={environmentForm.driver}
                    onChange={(e) =>
                      setEnvironmentForm((current) => ({
                        ...current,
                        sandboxProvider:
                          e.target.value === "sandbox"
                            ? current.sandboxProvider.trim() ||
                              discoveredPluginSandboxProviders[0]?.provider ||
                              ""
                            : current.sandboxProvider,
                        sandboxConfig:
                          e.target.value === "sandbox"
                            ? current.sandboxProvider.trim().length > 0 &&
                              current.driver === "sandbox"
                              ? current.sandboxConfig
                              : discoveredPluginSandboxProviders[0]
                                    ?.configSchema
                                ? getDefaultValues(
                                    discoveredPluginSandboxProviders[0]
                                      .configSchema as any,
                                  )
                                : {}
                            : current.sandboxConfig,
                        driver:
                          e.target.value === "local"
                            ? "local"
                            : e.target.value === "sandbox"
                              ? "sandbox"
                              : "ssh",
                      }))
                    }
                  >
                    {sandboxCreationEnabled ||
                    environmentForm.driver === "sandbox" ? (
                      <option value="sandbox">
                        {t("companySettings.sandbox")}
                      </option>
                    ) : null}
                    <option value="ssh">SSH</option>
                    {environmentForm.driver === "local" ? (
                      <option value="local">
                        {t("Local", { defaultValue: "Local" })}
                      </option>
                    ) : null}
                  </select>
                </Field>

                {environmentForm.driver === "ssh" ? (
                  <div className="grid gap-3 md:grid-cols-2">
                    <Field
                      label={t("companySettings.host")}
                      hint={t("companySettings.hostHint")}
                    >
                      <input
                        className="w-full rounded-md border border-border bg-transparent px-2.5 py-1.5 text-sm outline-none"
                        type="text"
                        value={environmentForm.sshHost}
                        onChange={(e) =>
                          setEnvironmentForm((current) => ({
                            ...current,
                            sshHost: e.target.value,
                          }))
                        }
                      />
                    </Field>
                    <Field
                      label={t("companySettings.port")}
                      hint={t("companySettings.portHint")}
                    >
                      <input
                        className="w-full rounded-md border border-border bg-transparent px-2.5 py-1.5 text-sm outline-none"
                        type="number"
                        min={1}
                        max={65535}
                        value={environmentForm.sshPort}
                        onChange={(e) =>
                          setEnvironmentForm((current) => ({
                            ...current,
                            sshPort: e.target.value,
                          }))
                        }
                      />
                    </Field>
                    <Field
                      label={t("companySettings.username")}
                      hint={t("companySettings.usernameHint")}
                    >
                      <input
                        className="w-full rounded-md border border-border bg-transparent px-2.5 py-1.5 text-sm outline-none"
                        type="text"
                        value={environmentForm.sshUsername}
                        onChange={(e) =>
                          setEnvironmentForm((current) => ({
                            ...current,
                            sshUsername: e.target.value,
                          }))
                        }
                      />
                    </Field>
                    <Field
                      label={t("companySettings.remoteWorkspacePath")}
                      hint={t("companySettings.remoteWorkspacePathHint")}
                    >
                      <input
                        className="w-full rounded-md border border-border bg-transparent px-2.5 py-1.5 text-sm outline-none"
                        type="text"
                        placeholder="/Users/paperclip/workspace"
                        value={environmentForm.sshRemoteWorkspacePath}
                        onChange={(e) =>
                          setEnvironmentForm((current) => ({
                            ...current,
                            sshRemoteWorkspacePath: e.target.value,
                          }))
                        }
                      />
                    </Field>
                    <Field
                      label={t("companySettings.privateKey")}
                      hint={t("companySettings.privateKeyHint")}
                    >
                      <div className="space-y-2">
                        <select
                          className="w-full rounded-md border border-border bg-transparent px-2.5 py-1.5 text-sm outline-none"
                          value={environmentForm.sshPrivateKeySecretId}
                          onChange={(e) =>
                            setEnvironmentForm((current) => ({
                              ...current,
                              sshPrivateKeySecretId: e.target.value,
                              sshPrivateKey: e.target.value
                                ? ""
                                : current.sshPrivateKey,
                            }))
                          }
                        >
                          <option value="">
                            {t("companySettings.noSavedSecret")}
                          </option>
                          {(secrets ?? []).map((secret) => (
                            <option key={secret.id} value={secret.id}>
                              {secret.name}
                            </option>
                          ))}
                        </select>
                        <textarea
                          className="h-32 w-full rounded-md border border-border bg-transparent px-2.5 py-1.5 text-xs font-mono outline-none"
                          value={environmentForm.sshPrivateKey}
                          disabled={!!environmentForm.sshPrivateKeySecretId}
                          onChange={(e) =>
                            setEnvironmentForm((current) => ({
                              ...current,
                              sshPrivateKey: e.target.value,
                            }))
                          }
                        />
                      </div>
                    </Field>
                    <Field
                      label={t("companySettings.knownHosts")}
                      hint={t("companySettings.knownHostsHint")}
                    >
                      <textarea
                        className="h-32 w-full rounded-md border border-border bg-transparent px-2.5 py-1.5 text-xs font-mono outline-none"
                        value={environmentForm.sshKnownHosts}
                        onChange={(e) =>
                          setEnvironmentForm((current) => ({
                            ...current,
                            sshKnownHosts: e.target.value,
                          }))
                        }
                      />
                    </Field>
                    <div className="md:col-span-2">
                      <ToggleField
                        label={t("companySettings.strictHostKeyChecking")}
                        hint={t("companySettings.strictHostKeyCheckingHint")}
                        checked={environmentForm.sshStrictHostKeyChecking}
                        onChange={(checked) =>
                          setEnvironmentForm((current) => ({
                            ...current,
                            sshStrictHostKeyChecking: checked,
                          }))
                        }
                      />
                    </div>
                  </div>
                ) : null}

                {environmentForm.driver === "sandbox" ? (
                  <div className="space-y-3">
                    <Field
                      label={t("companySettings.provider")}
                      hint={t("companySettings.sandboxProviderHint")}
                    >
                      <select
                        className="w-full rounded-md border border-border bg-transparent px-2.5 py-1.5 text-sm outline-none"
                        value={environmentForm.sandboxProvider}
                        onChange={(e) => {
                          const nextProviderKey = e.target.value;
                          const nextProvider =
                            pluginSandboxProviders.find(
                              (provider) =>
                                provider.provider === nextProviderKey,
                            ) ?? null;
                          setEnvironmentForm((current) => ({
                            ...current,
                            sandboxProvider: nextProviderKey,
                            sandboxConfig:
                              current.sandboxProvider === nextProviderKey
                                ? current.sandboxConfig
                                : nextProvider?.configSchema
                                  ? getDefaultValues(
                                      nextProvider.configSchema as any,
                                    )
                                  : {},
                          }));
                        }}
                      >
                        {pluginSandboxProviders.map((provider) => (
                          <option
                            key={provider.provider}
                            value={provider.provider}
                          >
                            {provider.displayName}
                          </option>
                        ))}
                      </select>
                    </Field>
                    {selectedSandboxProvider?.description ? (
                      <div className="text-xs text-muted-foreground">
                        {t(selectedSandboxProvider.description, {
                          defaultValue: selectedSandboxProvider.description,
                        })}
                      </div>
                    ) : null}
                    {selectedSandboxSchema ? (
                      <JsonSchemaForm
                        schema={selectedSandboxSchema as any}
                        values={environmentForm.sandboxConfig}
                        onChange={(values) =>
                          setEnvironmentForm((current) => ({
                            ...current,
                            sandboxConfig: values,
                          }))
                        }
                        errors={sandboxConfigErrors}
                      />
                    ) : (
                      <div className="rounded-md border border-border/60 bg-muted/20 px-3 py-2 text-xs text-muted-foreground">
                        {t("companySettings.sandboxNoExtraFields")}
                      </div>
                    )}
                    <ToggleField
                      label={t("companyEnvironments.streamLogs")}
                      hint="Stream the agent CLI's output live while sandbox runs execute (recommended). Turn off to deliver output only when the run finishes."
                      checked={
                        environmentForm.sandboxConfig.streamRunLogs !== false
                      }
                      onChange={(checked) =>
                        setEnvironmentForm((current) => ({
                          ...current,
                          sandboxConfig: {
                            ...current.sandboxConfig,
                            streamRunLogs: checked,
                          },
                        }))
                      }
                    />
                  </div>
                ) : null}

                {editingEnvironment &&
                editingEnvironment.driver === "sandbox" &&
                environmentForm.driver === "sandbox" &&
                selectedCompanyId ? (
                  <div className="space-y-2 rounded-md border border-border/60 bg-muted/20 px-3 py-3">
                    <div className="text-sm font-medium">
                      {t("companySettings.customImage.title", {
                        defaultValue: "Custom image",
                      })}
                    </div>
                    <div className="text-xs text-muted-foreground">
                      {t("companySettings.customImage.description", {
                        defaultValue:
                          "Start a setup sandbox, SSH in to customize the instance, then capture the running machine as a reusable image for future runs.",
                      })}
                    </div>
                    <EnvironmentImageTemplatePanel
                      environment={editingEnvironment}
                      companyId={selectedCompanyId}
                      providerCapability={editingSandboxCapability}
                      providerDisplayName={editingSandboxDisplayName}
                    />
                  </div>
                ) : null}

                <Field
                  label={t("companySettings.environmentVariables", {
                    defaultValue: "Environment variables",
                  })}
                  hint={t("companySettings.environmentVariablesHint", {
                    defaultValue:
                      "Injected into runs that resolve through this environment. Use plain values or company secrets.",
                  })}
                >
                  <EnvironmentVariablesEditor
                    ref={environmentVariablesEditorRef}
                    value={environmentForm.envVars}
                    secrets={secrets ?? []}
                    onCreateSecret={async (name, value) =>
                      await createSecret.mutateAsync({ name, value })
                    }
                    onChange={(env) =>
                      setEnvironmentForm((current) => ({
                        ...current,
                        envVars: env ?? {},
                      }))
                    }
                    onDirtyChange={setEnvironmentVariablesDirty}
                  />
                </Field>

                {environmentMutation.isError ? (
                  <div className="text-xs text-destructive">
                    {environmentMutation.error instanceof Error
                      ? environmentMutation.error.message
                      : t("companySettings.failedToSaveEnvironment")}
                  </div>
                ) : null}
                {draftEnvironmentProbeMutation.data ? (
                  <div
                    className={
                      draftEnvironmentProbeMutation.data.ok
                        ? "text-xs text-green-600"
                        : "text-xs text-destructive"
                    }
                  >
                    {draftEnvironmentProbeMutation.data.summary}
                  </div>
                ) : null}
              </div>
            </div>

            <div className="flex flex-wrap justify-end gap-2 border-t border-border/60 bg-background px-6 py-4">
              <Button
                variant="outline"
                onClick={closeEnvironmentForm}
                disabled={environmentMutation.isPending}
              >
                {t("Cancel", { defaultValue: "Cancel" })}
              </Button>
              {environmentForm.driver !== "local" ? (
                <Button
                  variant="outline"
                  onClick={() =>
                    draftEnvironmentProbeMutation.mutate(flushEnvironmentForm())
                  }
                  disabled={
                    draftEnvironmentProbeMutation.isPending ||
                    !environmentFormValid
                  }
                >
                  {draftEnvironmentProbeMutation.isPending
                    ? t("Testing...", { defaultValue: "Testing..." })
                    : t("Test", { defaultValue: "Test" })}
                </Button>
              ) : null}
              <Button
                onClick={() =>
                  environmentMutation.mutate(flushEnvironmentForm())
                }
                disabled={
                  environmentMutation.isPending || !environmentFormValid
                }
              >
                {environmentMutation.isPending
                  ? editingEnvironmentId
                    ? t("Saving...", { defaultValue: "Saving..." })
                    : t("companySettings.creating")
                  : editingEnvironmentId
                    ? t("companySettings.saveEnvironment")
                    : t("companySettings.createEnvironment")}
              </Button>
            </div>
          </div>
        </SecretRefHintsContext.Provider>
      ) : null}
    </div>
  );
}
