import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  DESKTOP_TITLEBAR_HEIGHT,
  DESKTOP_WINDOW_TITLE,
  type DesktopTheme,
} from "./runtime.js";
import { desktopText } from "./desktop-copy.js";

export type SplashState = "starting" | "waiting" | "stopping" | "error";

type SplashLocale = "zh-CN" | "en";

type SplashCopy = {
  status: string;
  footer: string;
  retryLabel?: string;
  errorDetail?: string;
};

type SplashThemeTokens = {
  colorScheme: "light" | "dark";
  backgroundStart: string;
  backgroundEnd: string;
  ambient: string;
  text: string;
  muted: string;
  line: string;
  progressTrack: string;
  progressFill: string;
  logoBorder: string;
  logoShadow: string;
  footer: string;
  panel: string;
  panelBorder: string;
  buttonBackground: string;
  buttonBorder: string;
  buttonText: string;
  buttonHover: string;
  errorPanel: string;
  errorBorder: string;
  errorText: string;
};

type SplashDataInput = {
  locale: string;
  theme: DesktopTheme;
  state: SplashState;
  detail?: string;
};

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const COPYRIGHT_FOOTER = "© 2026 Paperclip CN";

const FALLBACK_LOGO_SVG = `
<svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
  <path
    d="m16 6-8.414 8.586a2 2 0 0 0 2.829 2.829l8.414-8.586a4 4 0 1 0-5.657-5.657l-8.379 8.551a6 6 0 1 0 8.485 8.485l8.379-8.551"
    stroke="currentColor"
    stroke-width="2"
    stroke-linecap="round"
    stroke-linejoin="round"
  />
</svg>
`;

function resolveSplashLogoPath(): string | null {
  const candidates = [
    path.resolve(__dirname, "icon.png"),
    path.resolve(__dirname, "..", "assets", "icon.png"),
  ];

  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) {
      return candidate;
    }
  }

  return null;
}

function createFallbackLogoDataUrl(): string {
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(FALLBACK_LOGO_SVG)}`;
}

function createSplashLogoDataUrl(): string {
  const logoPath = resolveSplashLogoPath();
  if (!logoPath) {
    return createFallbackLogoDataUrl();
  }

  try {
    return `data:image/png;base64,${fs.readFileSync(logoPath).toString("base64")}`;
  } catch {
    return createFallbackLogoDataUrl();
  }
}

const PAPERCLIP_LOGO_DATA_URL = createSplashLogoDataUrl();

function escapeHtml(input: string): string {
  return input
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function resolveLocale(locale: string): SplashLocale {
  return locale.toLowerCase().startsWith("zh") ? "zh-CN" : "en";
}

function getSplashCopy(locale: SplashLocale, state: SplashState, detail?: string): SplashCopy {
  if (state === "stopping") {
    return {
      status: desktopText("desktop.shutdown.title", locale),
      footer: desktopText("desktop.shutdown.message", locale),
    };
  }
  if (locale === "zh-CN") {
    if (state === "starting") {
      return {
        status: "正在打开 Paperclip",
        footer: COPYRIGHT_FOOTER,
      };
    }

    if (state === "waiting") {
      return {
        status: "马上就好，正在连接你的本地工作台",
        footer: COPYRIGHT_FOOTER,
      };
    }

    return {
      status: "这次启动没有成功",
      footer: COPYRIGHT_FOOTER,
      retryLabel: "再试一次",
      errorDetail: detail?.trim() || "本地运行环境未能正常启动。",
    };
  }

  if (state === "starting") {
    return {
      status: "Opening Paperclip",
      footer: COPYRIGHT_FOOTER,
    };
  }

  if (state === "waiting") {
    return {
      status: "Almost there. Connecting your local workspace.",
      footer: COPYRIGHT_FOOTER,
    };
  }

  return {
    status: "Paperclip couldn't start this time",
    footer: COPYRIGHT_FOOTER,
    retryLabel: "Try again",
    errorDetail: detail?.trim() || "The local runtime didn't start as expected.",
  };
}

function getSplashThemeTokens(theme: DesktopTheme): SplashThemeTokens {
  if (theme === "dark") {
    return {
      colorScheme: "dark",
      backgroundStart: "#1c1c1e",
      backgroundEnd: "#171719",
      ambient: "rgba(255, 255, 255, 0.035)",
      text: "#f5f5f7",
      muted: "rgba(245, 245, 247, 0.68)",
      line: "rgba(255, 255, 255, 0.12)",
      progressTrack: "rgba(255, 255, 255, 0.1)",
      progressFill: "linear-gradient(90deg, rgba(255,255,255,0.18), rgba(255,255,255,0.96), rgba(255,255,255,0.22))",
      logoBorder: "rgba(255, 255, 255, 0.08)",
      logoShadow: "0 18px 38px rgba(0, 0, 0, 0.22)",
      footer: "rgba(245, 245, 247, 0.36)",
      panel: "rgba(255, 255, 255, 0.05)",
      panelBorder: "rgba(255, 255, 255, 0.08)",
      buttonBackground: "rgba(255, 255, 255, 0.08)",
      buttonBorder: "rgba(255, 255, 255, 0.1)",
      buttonText: "#f5f5f7",
      buttonHover: "rgba(255, 255, 255, 0.14)",
      errorPanel: "rgba(123, 24, 24, 0.16)",
      errorBorder: "rgba(255, 111, 111, 0.2)",
      errorText: "#ffd4d4",
    };
  }

  return {
    colorScheme: "light",
    backgroundStart: "#f5f2ea",
    backgroundEnd: "#efeae1",
    ambient: "rgba(15, 23, 42, 0.035)",
    text: "#1c1c1f",
    muted: "rgba(28, 28, 31, 0.58)",
    line: "rgba(17, 24, 39, 0.14)",
    progressTrack: "rgba(15, 23, 42, 0.12)",
    progressFill: "linear-gradient(90deg, rgba(15,23,42,0.16), rgba(28,28,31,0.9), rgba(15,23,42,0.18))",
    logoBorder: "rgba(15, 23, 42, 0.08)",
    logoShadow: "0 16px 34px rgba(15, 23, 42, 0.08)",
    footer: "rgba(28, 28, 31, 0.34)",
    panel: "rgba(255, 255, 255, 0.7)",
    panelBorder: "rgba(15, 23, 42, 0.08)",
    buttonBackground: "rgba(255, 255, 255, 0.76)",
    buttonBorder: "rgba(15, 23, 42, 0.08)",
    buttonText: "#1c1c1f",
    buttonHover: "rgba(255, 255, 255, 0.92)",
    errorPanel: "rgba(255, 239, 239, 0.82)",
    errorBorder: "rgba(190, 24, 24, 0.14)",
    errorText: "#991b1b",
  };
}

export function createSplashDataUrl(input: SplashDataInput): string {
  const locale = resolveLocale(input.locale);
  const copy = getSplashCopy(locale, input.state, input.detail);
  const isError = input.state === "error";
  const showProgress = !isError;
  const themeTokens = getSplashThemeTokens(input.theme);
  const detail = isError && copy.errorDetail
    ? `<pre data-testid="splash-error-detail">${escapeHtml(copy.errorDetail)}</pre>`
    : "";
  const action = isError && copy.retryLabel
    ? `<button id="retry" type="button" data-testid="splash-retry">${escapeHtml(copy.retryLabel)}</button>
<script>
  document.getElementById("retry")?.addEventListener("click", () => {
    window.desktopShell?.retryStart?.();
  });
</script>`
    : "";

  const html = `<!doctype html>
<html lang="${locale}">
  <head>
    <meta charset="utf-8" />
    <meta
      name="viewport"
      content="width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no, viewport-fit=cover"
    />
    <title>${escapeHtml(DESKTOP_WINDOW_TITLE)}</title>
    <style>
      :root {
        color-scheme: ${themeTokens.colorScheme};
        font-family: "Segoe UI", "Microsoft YaHei UI", sans-serif;
        --bg-start: ${themeTokens.backgroundStart};
        --bg-end: ${themeTokens.backgroundEnd};
        --ambient: ${themeTokens.ambient};
        --text: ${themeTokens.text};
        --muted: ${themeTokens.muted};
        --line: ${themeTokens.line};
        --progress-track: ${themeTokens.progressTrack};
        --progress-fill: ${themeTokens.progressFill};
        --logo-border: ${themeTokens.logoBorder};
        --logo-shadow: ${themeTokens.logoShadow};
        --footer: ${themeTokens.footer};
        --panel: ${themeTokens.panel};
        --panel-border: ${themeTokens.panelBorder};
        --button-bg: ${themeTokens.buttonBackground};
        --button-border: ${themeTokens.buttonBorder};
        --button-text: ${themeTokens.buttonText};
        --button-hover: ${themeTokens.buttonHover};
        --error-panel: ${themeTokens.errorPanel};
        --error-border: ${themeTokens.errorBorder};
        --error-text: ${themeTokens.errorText};
      }
      * {
        box-sizing: border-box;
      }
      html,
      body {
        margin: 0;
        min-height: 100vh;
        overflow: hidden;
        background: linear-gradient(180deg, var(--bg-start) 0%, var(--bg-end) 100%);
        color: var(--text);
      }
      body {
        position: relative;
        padding:
          calc(env(safe-area-inset-top) + ${DESKTOP_TITLEBAR_HEIGHT}px + 24px)
          24px
          calc(env(safe-area-inset-bottom) + 56px);
      }
      body,
      .cet-container {
        display: grid;
        place-items: center;
      }
      .cet-container {
        width: 100%;
        padding: 0 24px;
      }
      body::before {
        content: "";
        position: absolute;
        inset: 0;
        pointer-events: none;
        background: radial-gradient(circle at 50% 18%, var(--ambient), transparent 38%);
      }
      .shell {
        position: relative;
        z-index: 1;
        width: min(100%, 292px);
        display: grid;
        gap: 14px;
        justify-items: center;
        text-align: center;
      }
      .logo-wrap {
        width: 60px;
        height: 60px;
        display: grid;
        place-items: center;
        animation: logo-fade 420ms ease-out both;
      }
      .logo {
        width: 60px;
        height: 60px;
        border-radius: 17px;
        border: 1px solid var(--logo-border);
        object-fit: cover;
        box-shadow: var(--logo-shadow);
      }
      .progress {
        width: min(100%, 204px);
        height: 3px;
        overflow: hidden;
        border-radius: 999px;
        background: var(--progress-track);
      }
      .progress > span {
        display: ${showProgress ? "block" : "none"};
        width: 42%;
        height: 100%;
        border-radius: inherit;
        background: var(--progress-fill);
        animation: progress-flow 1.6s ease-in-out infinite;
      }
      .status {
        margin: 0;
        max-width: 24ch;
        font-size: 13px;
        line-height: 1.55;
        font-weight: 500;
        letter-spacing: 0.01em;
        color: var(--muted);
      }
      pre {
        margin: 2px 0 0;
        width: min(100%, 292px);
        max-height: 140px;
        overflow: auto;
        border-radius: 16px;
        border: 1px solid var(--error-border);
        padding: 12px 14px;
        background: var(--error-panel);
        color: var(--error-text);
        text-align: left;
        white-space: pre-wrap;
        word-break: break-word;
        font: 11px/1.55 "Cascadia Code", "Consolas", monospace;
      }
      button {
        margin: 4px 0 0;
        min-width: 112px;
        border: 1px solid var(--button-border);
        border-radius: 999px;
        padding: 10px 16px;
        background: var(--button-bg);
        color: var(--button-text);
        font: 600 12px/1 "Segoe UI", "Microsoft YaHei UI", sans-serif;
        cursor: pointer;
        transition: background-color 140ms ease, border-color 140ms ease;
      }
      button:hover {
        background: var(--button-hover);
      }
      .footer {
        position: fixed;
        left: 50%;
        bottom: calc(env(safe-area-inset-bottom) + 16px);
        transform: translateX(-50%);
        z-index: 1;
        width: calc(100% - 28px);
        text-align: center;
        font-size: 10px;
        line-height: 1.4;
        letter-spacing: 0.03em;
        color: var(--footer);
      }
      @keyframes progress-flow {
        0% {
          transform: translateX(-34%);
          opacity: 0.44;
        }
        50% {
          transform: translateX(170%);
          opacity: 1;
        }
        100% {
          transform: translateX(-34%);
          opacity: 0.44;
        }
      }
      @keyframes logo-fade {
        from {
          opacity: 0;
          transform: translateY(4px);
        }
        to {
          opacity: 1;
          transform: translateY(0);
        }
      }
      @media (max-width: 720px) {
        body {
          padding-left: 18px;
          padding-right: 18px;
          padding-bottom: 50px;
        }
        .cet-container {
          padding: 0 18px;
        }
        .shell {
          width: min(100%, 276px);
          gap: 13px;
        }
        .logo-wrap,
        .logo {
          width: 56px;
          height: 56px;
        }
        .progress {
          width: min(100%, 188px);
        }
        .status {
          font-size: 12px;
        }
        pre {
          width: 100%;
        }
      }
    </style>
  </head>
  <body>
    <main class="shell">
      <div class="logo-wrap">
        <img
          class="logo"
          data-testid="splash-logo"
          alt="Paperclip logo"
          src="${PAPERCLIP_LOGO_DATA_URL}"
        />
      </div>
      <div class="progress" data-testid="splash-progress" aria-hidden="${showProgress ? "false" : "true"}">
        <span data-testid="splash-progress-bar"></span>
      </div>
      <p class="status" data-testid="splash-status">${escapeHtml(copy.status)}</p>
      ${detail}
      ${action}
    </main>
    <footer class="footer" data-testid="splash-footer">${escapeHtml(copy.footer)}</footer>
  </body>
</html>`;

  return `data:text/html;charset=utf-8,${encodeURIComponent(html)}`;
}
