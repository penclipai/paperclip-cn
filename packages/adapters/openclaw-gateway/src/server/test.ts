import type {
  AdapterEnvironmentCheck,
  AdapterEnvironmentTestContext,
  AdapterEnvironmentTestResult,
} from "@penclipai/adapter-utils";
import { asString, parseObject } from "@penclipai/adapter-utils/server-utils";
import { randomUUID } from "node:crypto";
import { WebSocket } from "ws";

const PROTOCOL_VERSION = 4;

function summarizeStatus(checks: AdapterEnvironmentCheck[]): AdapterEnvironmentTestResult["status"] {
  if (checks.some((check) => check.level === "error")) return "fail";
  if (checks.some((check) => check.level === "warn")) return "warn";
  return "pass";
}

function nonEmpty(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

function isLoopbackHost(hostname: string): boolean {
  const value = hostname.trim().toLowerCase();
  return value === "localhost" || value === "127.0.0.1" || value === "::1";
}

function toStringRecord(value: unknown): Record<string, string> {
  const parsed = parseObject(value);
  const out: Record<string, string> = {};
  for (const [key, entry] of Object.entries(parsed)) {
    if (typeof entry === "string") out[key] = entry;
  }
  return out;
}

function toStringArray(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value
      .filter((entry): entry is string => typeof entry === "string")
      .map((entry) => entry.trim())
      .filter(Boolean);
  }
  if (typeof value === "string") {
    return value
      .split(",")
      .map((entry) => entry.trim())
      .filter(Boolean);
  }
  return [];
}

function headerMapGetIgnoreCase(headers: Record<string, string>, key: string): string | null {
  const match = Object.entries(headers).find(([entryKey]) => entryKey.toLowerCase() === key.toLowerCase());
  return match ? match[1] : null;
}

function tokenFromAuthHeader(rawHeader: string | null): string | null {
  if (!rawHeader) return null;
  const trimmed = rawHeader.trim();
  if (!trimmed) return null;
  const match = trimmed.match(/^bearer\s+(.+)$/i);
  return match ? nonEmpty(match[1]) : trimmed;
}

function resolveAuthToken(config: Record<string, unknown>, headers: Record<string, string>): string | null {
  const explicit = nonEmpty(config.authToken) ?? nonEmpty(config.token);
  if (explicit) return explicit;

  const tokenHeader = headerMapGetIgnoreCase(headers, "x-openclaw-token");
  if (nonEmpty(tokenHeader)) return nonEmpty(tokenHeader);

  const authHeader =
    headerMapGetIgnoreCase(headers, "x-openclaw-auth") ??
    headerMapGetIgnoreCase(headers, "authorization");
  return tokenFromAuthHeader(authHeader);
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function rawDataToString(data: unknown): string {
  if (typeof data === "string") return data;
  if (Buffer.isBuffer(data)) return data.toString("utf8");
  if (data instanceof ArrayBuffer) return Buffer.from(data).toString("utf8");
  if (Array.isArray(data)) {
    return Buffer.concat(
      data.map((entry) => (Buffer.isBuffer(entry) ? entry : Buffer.from(String(entry), "utf8"))),
    ).toString("utf8");
  }
  return String(data ?? "");
}

type ProbeGatewayResult =
  | { status: "ok"; protocol: number | null; detail?: string }
  | { status: "challenge_only" | "failed"; protocol: number | null; detail?: string };

function formatProbeError(event: Record<string, unknown>): string | undefined {
  const error = asRecord(event.error);
  if (!error) return undefined;
  const message = nonEmpty(error.message) ?? nonEmpty(error.code) ?? "gateway rejected connect probe";
  const details = asRecord(error.details);
  if (!details || Object.keys(details).length === 0) return message;
  return `${message}; details=${JSON.stringify(details)}`;
}

async function probeGateway(input: {
  url: string;
  headers: Record<string, string>;
  authToken: string | null;
  role: string;
  scopes: string[];
  timeoutMs: number;
}): Promise<ProbeGatewayResult> {
  return await new Promise((resolve) => {
    const ws = new WebSocket(input.url, { headers: input.headers, maxPayload: 2 * 1024 * 1024 });
    const timeout = setTimeout(() => {
      try {
        ws.close();
      } catch {
        // ignore
      }
      resolve({ status: "failed", protocol: null, detail: "gateway connect challenge timeout" });
    }, input.timeoutMs);

    let completed = false;

    const finish = (result: ProbeGatewayResult) => {
      if (completed) return;
      completed = true;
      clearTimeout(timeout);
      try {
        ws.close();
      } catch {
        // ignore
      }
      resolve(result);
    };

    ws.on("message", (raw) => {
      let parsed: unknown;
      try {
        parsed = JSON.parse(rawDataToString(raw));
      } catch {
        return;
      }
      const event = asRecord(parsed);
      if (event?.type === "event" && event.event === "connect.challenge") {
        const nonce = nonEmpty(asRecord(event.payload)?.nonce);
        if (!nonce) {
          finish({ status: "failed", protocol: null, detail: "connect.challenge did not include nonce" });
          return;
        }

        const connectId = randomUUID();
        ws.send(
          JSON.stringify({
            type: "req",
            id: connectId,
            method: "connect",
            params: {
              minProtocol: PROTOCOL_VERSION,
              maxProtocol: PROTOCOL_VERSION,
              client: {
                id: "gateway-client",
                version: "paperclip-probe",
                platform: process.platform,
                mode: "probe",
              },
              role: input.role,
              scopes: input.scopes,
              ...(input.authToken
                ? {
                    auth: {
                      token: input.authToken,
                    },
                  }
                : {}),
            },
          }),
        );
        return;
      }

      if (event?.type === "res") {
        if (event.ok === true) {
          const payload = asRecord(event.payload);
          finish({
            status: "ok",
            protocol: typeof payload?.protocol === "number" ? payload.protocol : null,
          });
        } else {
          finish({ status: "challenge_only", protocol: null, detail: formatProbeError(event) });
        }
      }
    });

    ws.on("error", () => {
      finish({ status: "failed", protocol: null, detail: "websocket connection failed" });
    });

    ws.on("close", () => {
      if (!completed) finish({ status: "failed", protocol: null, detail: "gateway closed before probe completed" });
    });
  });
}

export async function testEnvironment(
  ctx: AdapterEnvironmentTestContext,
): Promise<AdapterEnvironmentTestResult> {
  const checks: AdapterEnvironmentCheck[] = [];
  const config = parseObject(ctx.config);
  const urlValue = asString(config.url, "").trim();

  if (!urlValue) {
    checks.push({
      code: "openclaw_gateway_url_missing",
      level: "error",
      message: "OpenClaw gateway adapter requires a WebSocket URL.",
      hint: "Set adapterConfig.url to ws://host:port (or wss://).",
    });
    return {
      adapterType: ctx.adapterType,
      status: summarizeStatus(checks),
      checks,
      testedAt: new Date().toISOString(),
    };
  }

  let url: URL | null = null;
  try {
    url = new URL(urlValue);
  } catch {
    checks.push({
      code: "openclaw_gateway_url_invalid",
      level: "error",
      message: `Invalid URL: ${urlValue}`,
    });
  }

  if (url && url.protocol !== "ws:" && url.protocol !== "wss:") {
    checks.push({
      code: "openclaw_gateway_url_protocol_invalid",
      level: "error",
      message: `Unsupported URL protocol: ${url.protocol}`,
      hint: "Use ws:// or wss://.",
    });
  }

  if (url) {
    checks.push({
      code: "openclaw_gateway_url_valid",
      level: "info",
      message: `Configured gateway URL: ${url.toString()}`,
    });

    if (url.protocol === "ws:" && !isLoopbackHost(url.hostname)) {
      checks.push({
        code: "openclaw_gateway_plaintext_remote_ws",
        level: "warn",
        message: "Gateway URL uses plaintext ws:// on a non-loopback host.",
        hint: "Prefer wss:// for remote gateways.",
      });
    }
  }

  const headers = toStringRecord(config.headers);
  const authToken = resolveAuthToken(config, headers);
  const password = nonEmpty(config.password);
  const role = nonEmpty(config.role) ?? "operator";
  const scopes = toStringArray(config.scopes);

  if (authToken || password) {
    checks.push({
      code: "openclaw_gateway_auth_present",
      level: "info",
      message: "Gateway credentials are configured.",
    });
  } else {
    checks.push({
      code: "openclaw_gateway_auth_missing",
      level: "warn",
      message: "No gateway credentials detected in adapter config.",
      hint: "Set authToken/password or headers.x-openclaw-token for authenticated gateways.",
    });
  }

  if (url && (url.protocol === "ws:" || url.protocol === "wss:")) {
    try {
      const probeResult = await probeGateway({
        url: url.toString(),
        headers,
        authToken,
        role,
        scopes: scopes.length > 0 ? scopes : ["operator.admin"],
        timeoutMs: 3_000,
      });

      if (probeResult.status === "ok") {
        checks.push({
          code: "openclaw_gateway_probe_ok",
          level: "info",
          message: `Gateway connect probe succeeded${probeResult.protocol ? ` with protocol ${probeResult.protocol}` : ""}.`,
        });
      } else if (probeResult.status === "challenge_only") {
        checks.push({
          code: "openclaw_gateway_probe_challenge_only",
          level: "warn",
          message: "Gateway challenge was received, but connect probe was rejected.",
          detail: probeResult.detail,
          hint: "Check gateway credentials, scopes, role, protocol compatibility, and device-auth requirements.",
        });
      } else {
        checks.push({
          code: "openclaw_gateway_probe_failed",
          level: "warn",
          message: "Gateway probe failed.",
          detail: probeResult.detail,
          hint: "Verify network reachability and gateway URL from the Paperclip server host.",
        });
      }
    } catch (err) {
      checks.push({
        code: "openclaw_gateway_probe_error",
        level: "warn",
        message: err instanceof Error ? err.message : "Gateway probe failed",
      });
    }
  }

  return {
    adapterType: ctx.adapterType,
    status: summarizeStatus(checks),
    checks,
    testedAt: new Date().toISOString(),
  };
}
