import {
  createTitlebar,
  createTitlebarOnDOMContentLoaded,
  type CustomTitlebar,
  type TitleBarOptions,
  TitlebarColor,
} from "custom-electron-titlebar";
import { contextBridge, ipcRenderer } from "electron";
import {
  DESKTOP_TITLEBAR_HEIGHT,
  getDesktopTitlebarThemeConfig,
  getDesktopWindowBackground,
  isDesktopTheme,
  type DesktopTheme,
} from "./runtime.js";

function resolveInitialThemeArgument(): DesktopTheme | null {
  const prefix = "--paperclip-desktop-initial-theme=";

  for (const arg of process.argv) {
    if (!arg.startsWith(prefix)) {
      continue;
    }

    const value = arg.slice(prefix.length);
    return isDesktopTheme(value) ? value : null;
  }

  return null;
}

const initialTheme = resolveInitialThemeArgument();
let currentTheme: DesktopTheme | null = initialTheme;
let titlebarPromise: Promise<CustomTitlebar> | null = null;
const TITLEBAR_THEME_STYLE_ID = "paperclip-desktop-titlebar-theme";
const NAVIGATION_CONTAINER_SELECTOR = "[data-paperclip-desktop-nav]";
const TITLEBAR_DIVIDER_SELECTOR = '[data-testid="desktop-titlebar-divider"]';
let navigationControls: {
  back: HTMLButtonElement;
  forward: HTMLButtonElement;
} | null = null;
let navigationState = {
  canGoBack: false,
  canGoForward: false,
};
let colorNormalizationContext: CanvasRenderingContext2D | null = null;

type NavigationState = {
  canGoBack: boolean;
  canGoForward: boolean;
};

type ResolvedTitlebarColors = {
  background: string;
  border: string;
  foreground: string;
  hover: string;
  menuBackground: string;
  menuSelection: string;
  menuSeparator: string;
  svg: string;
  iconFilter: string;
};

function isSplashDocument(): boolean {
  return window.location.protocol === "data:";
}

function clampByte(value: number): number {
  return Math.max(0, Math.min(255, Math.round(value)));
}

function byteToHex(value: number): string {
  return clampByte(value).toString(16).padStart(2, "0");
}

function rgbaToHex(red: number, green: number, blue: number, alpha = 1): string {
  const normalizedAlpha = Number.isFinite(alpha) ? Math.max(0, Math.min(1, alpha)) : 1;
  const base = `#${byteToHex(red)}${byteToHex(green)}${byteToHex(blue)}`;
  return normalizedAlpha >= 0.999 ? base : `${base}${byteToHex(normalizedAlpha * 255)}`;
}

function parseColorToHex(value: string): string | null {
  const trimmed = value.trim().toLowerCase();

  if (!trimmed) {
    return null;
  }

  if (trimmed === "transparent") {
    return "#00000000";
  }

  if (/^#[0-9a-f]{6}([0-9a-f]{2})?$/i.test(trimmed)) {
    return trimmed;
  }

  if (/^#[0-9a-f]{3,4}$/i.test(trimmed)) {
    const [, red = "0", green = "0", blue = "0", alpha = ""] = trimmed;
    const expanded = `#${red}${red}${green}${green}${blue}${blue}`;
    return alpha ? `${expanded}${alpha}${alpha}` : expanded;
  }

  if (!trimmed.startsWith("rgb")) {
    return null;
  }

  const channels = trimmed.match(/[\d.]+/g);
  if (!channels || channels.length < 3) {
    return null;
  }

  const [red = 0, green = 0, blue = 0, alpha = 1] = channels.map(Number);
  return rgbaToHex(red, green, blue, alpha);
}

function getColorNormalizationContext(): CanvasRenderingContext2D | null {
  if (colorNormalizationContext) {
    return colorNormalizationContext;
  }

  const canvas = document.createElement("canvas");
  colorNormalizationContext = canvas.getContext("2d");
  return colorNormalizationContext;
}

function normalizeColor(value: string, fallback: string): string {
  const context = getColorNormalizationContext();
  if (!context) {
    return parseColorToHex(value) ?? fallback;
  }

  try {
    context.canvas.width = 1;
    context.canvas.height = 1;
    context.clearRect(0, 0, 1, 1);
    context.fillStyle = fallback;
    context.fillStyle = value;
    context.fillRect(0, 0, 1, 1);
    const [red = 0, green = 0, blue = 0, alpha = 255] = context.getImageData(0, 0, 1, 1).data;
    return rgbaToHex(red, green, blue, alpha / 255);
  } catch {
    return parseColorToHex(value) ?? fallback;
  }
}

function resolveCssCustomPropertyColor(
  variableName: string,
  property: "color" | "backgroundColor",
  fallback: string,
): string {
  if (isSplashDocument()) {
    return fallback;
  }

  const probe = document.createElement("span");
  probe.setAttribute("aria-hidden", "true");
  probe.style.position = "absolute";
  probe.style.width = "0";
  probe.style.height = "0";
  probe.style.opacity = "0";
  probe.style.pointerEvents = "none";
  probe.style.color = property === "color" ? `var(${variableName})` : "transparent";
  probe.style.backgroundColor = property === "backgroundColor" ? `var(${variableName})` : "transparent";

  (document.body ?? document.documentElement).append(probe);
  const resolved = getComputedStyle(probe)[property];
  probe.remove();

  return normalizeColor(resolved, fallback);
}

function resolveTitlebarColors(theme: DesktopTheme): ResolvedTitlebarColors {
  const themeConfig = getDesktopTitlebarThemeConfig(theme);

  if (isSplashDocument()) {
    return {
      background: themeConfig.colors.titlebar,
      border: "transparent",
      foreground: themeConfig.colors.titlebarForeground,
      hover: theme === "dark" ? "#ffffff14" : "#0f172a14",
      menuBackground: themeConfig.colors.menuBar,
      menuSelection: themeConfig.colors.menuItemSelection,
      menuSeparator: themeConfig.colors.menuSeparator,
      svg: themeConfig.colors.svg,
      iconFilter: themeConfig.iconFilter,
    };
  }

  return {
    background: resolveCssCustomPropertyColor(
      "--background",
      "backgroundColor",
      getDesktopWindowBackground(theme),
    ),
    border: resolveCssCustomPropertyColor("--border", "color", themeConfig.colors.menuSeparator),
    foreground: resolveCssCustomPropertyColor("--foreground", "color", themeConfig.colors.titlebarForeground),
    hover: theme === "dark" ? "#ffffff14" : "#0f172a14",
    menuBackground: resolveCssCustomPropertyColor(
      "--background",
      "backgroundColor",
      themeConfig.colors.menuBar,
    ),
    menuSelection: themeConfig.colors.menuItemSelection,
    menuSeparator: resolveCssCustomPropertyColor("--border", "color", themeConfig.colors.menuSeparator),
    svg: resolveCssCustomPropertyColor("--foreground", "color", themeConfig.colors.svg),
    iconFilter: themeConfig.iconFilter,
  };
}

function resolveDocumentTheme(): DesktopTheme {
  if (document.documentElement.classList.contains("dark")) {
    return "dark";
  }

  return window.matchMedia?.("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

function upsertTitlebarThemeStyle(theme: DesktopTheme, colors: ResolvedTitlebarColors): void {
  let styleElement = document.getElementById(TITLEBAR_THEME_STYLE_ID);

  if (!(styleElement instanceof HTMLStyleElement)) {
    styleElement = document.createElement("style");
    styleElement.id = TITLEBAR_THEME_STYLE_ID;
    document.head.append(styleElement);
  }

  styleElement.textContent = `
.cet-titlebar {
  background: ${colors.background} !important;
  border-bottom: none !important;
}

.cet-titlebar .cet-menubar {
  background: ${colors.menuBackground};
}

.cet-titlebar .cet-menubar-menu-title {
  color: ${colors.foreground};
}

.cet-titlebar .cet-control-icon svg {
  fill: ${colors.foreground} !important;
}

.cet-titlebar .cet-icon img {
  filter: ${colors.iconFilter};
}

.cet-menubar-menu-container {
  background: ${colors.menuBackground};
  color: ${colors.foreground};
}

.cet-menubar-menu-container .cet-action-item.active .cet-action-menu-item,
.cet-menubar-menu-container .cet-action-menu-item:hover {
  background: ${colors.menuSelection};
}

.cet-menubar-menu-container .cet-action-label.separator {
  border-bottom-color: ${colors.menuSeparator};
}

.cet-menubar-menu-container .cet-menu-item-icon svg,
.cet-menubar-menu-container .cet-submenu-indicator svg {
  fill: ${colors.svg};
}

.cet-titlebar .paperclip-desktop-nav {
  display: flex;
  align-items: center;
  gap: 4px;
  margin-left: 2px;
  -webkit-app-region: no-drag;
}

.cet-titlebar .paperclip-desktop-nav-button {
  width: 28px;
  height: 28px;
  padding: 0;
  border: none;
  border-radius: 6px;
  background: transparent;
  color: ${colors.foreground};
  display: inline-flex;
  align-items: center;
  justify-content: center;
  cursor: default;
  -webkit-app-region: no-drag;
}

.cet-titlebar .paperclip-desktop-nav-button:hover:not(:disabled) {
  background: ${colors.hover};
}

.cet-titlebar .paperclip-desktop-nav-button:disabled {
  opacity: 0.38;
}

.cet-titlebar .paperclip-desktop-nav-button svg {
  width: 14px;
  height: 14px;
  stroke: currentColor;
  fill: none;
  stroke-width: 2;
  stroke-linecap: round;
  stroke-linejoin: round;
}

.paperclip-desktop-titlebar-divider {
  position: fixed;
  left: 0;
  right: 0;
  height: 1px;
  pointer-events: none;
  z-index: 99998;
}
`;
}

function createNavigationButton(
  testId: "desktop-nav-back" | "desktop-nav-forward",
  label: string,
  svgPath: string,
  invokeChannel: "desktop-shell:navigate-back" | "desktop-shell:navigate-forward",
): HTMLButtonElement {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "paperclip-desktop-nav-button";
  button.setAttribute("data-testid", testId);
  button.setAttribute("aria-label", label);
  button.title = label;
  button.innerHTML = `
<svg viewBox="0 0 16 16" aria-hidden="true" focusable="false">
  <path d="${svgPath}" />
</svg>
`;
  button.addEventListener("click", () => {
    if (button.disabled) {
      return;
    }

    void ipcRenderer.invoke(invokeChannel).catch((error) => {
      console.warn(`[desktop-preload] Failed to invoke ${invokeChannel}:`, error);
    });
  });
  return button;
}

function applyNavigationState(): void {
  if (!navigationControls) {
    return;
  }

  navigationControls.back.disabled = !navigationState.canGoBack;
  navigationControls.forward.disabled = !navigationState.canGoForward;
}

function setNavigationState(state: NavigationState): void {
  navigationState = state;
  applyNavigationState();
}

function ensureNavigationControls(titlebar: CustomTitlebar): void {
  if (isSplashDocument()) {
    navigationControls = null;
    return;
  }

  const existingContainer = titlebar.titlebarElement.querySelector<HTMLElement>(NAVIGATION_CONTAINER_SELECTOR);

  if (existingContainer) {
    const back = existingContainer.querySelector<HTMLButtonElement>('[data-testid="desktop-nav-back"]');
    const forward = existingContainer.querySelector<HTMLButtonElement>('[data-testid="desktop-nav-forward"]');

    if (back && forward) {
      navigationControls = { back, forward };
      applyNavigationState();
      return;
    }

    existingContainer.remove();
  }

  const container = document.createElement("div");
  container.className = "paperclip-desktop-nav";
  container.setAttribute("data-paperclip-desktop-nav", "true");

  const back = createNavigationButton(
    "desktop-nav-back",
    "Back",
    "M10.5 3.5 6 8l4.5 4.5M6.5 8H14",
    "desktop-shell:navigate-back",
  );
  const forward = createNavigationButton(
    "desktop-nav-forward",
    "Forward",
    "M5.5 3.5 10 8l-4.5 4.5M2 8h7.5",
    "desktop-shell:navigate-forward",
  );

  container.append(back, forward);

  const icon = titlebar.titlebarElement.querySelector(".cet-icon");
  if (icon?.parentElement) {
    icon.insertAdjacentElement("afterend", container);
  } else {
    titlebar.titlebarElement.prepend(container);
  }

  navigationControls = { back, forward };
  applyNavigationState();
}

function ensureTitlebarDivider(): HTMLDivElement {
  const existingDivider = document.querySelector<HTMLDivElement>(TITLEBAR_DIVIDER_SELECTOR);
  if (existingDivider) {
    return existingDivider;
  }

  const divider = document.createElement("div");
  divider.className = "paperclip-desktop-titlebar-divider";
  divider.setAttribute("data-testid", "desktop-titlebar-divider");
  divider.setAttribute("aria-hidden", "true");
  document.body.append(divider);
  return divider;
}

async function refreshNavigationState(): Promise<void> {
  if (isSplashDocument()) {
    setNavigationState({ canGoBack: false, canGoForward: false });
    return;
  }

  try {
    const nextState = await ipcRenderer.invoke("desktop-shell:get-navigation-state");
    if (!nextState || typeof nextState !== "object") {
      return;
    }

    setNavigationState({
      canGoBack: Boolean((nextState as Partial<NavigationState>).canGoBack),
      canGoForward: Boolean((nextState as Partial<NavigationState>).canGoForward),
    });
  } catch (error) {
    console.warn("[desktop-preload] Failed to refresh navigation state:", error);
  }
}

function applyThemeToTitlebar(titlebar: CustomTitlebar, theme: DesktopTheme): void {
  const themeConfig = getDesktopTitlebarThemeConfig(theme);
  const colors = resolveTitlebarColors(theme);
  const baseSize = Math.max(10, Math.floor(themeConfig.fontSize));
  const isSplash = isSplashDocument();

  titlebar.titlebarElement.style.setProperty("--cet-font-family", themeConfig.fontFamily);
  titlebar.titlebarElement.style.setProperty("--cet-font-size", `${baseSize}px`);
  titlebar.titlebarElement.style.setProperty("--cet-title-font-size", `${Math.max(10, baseSize - 1)}px`);
  titlebar.titlebarElement.style.setProperty("--cet-menu-font-size", `${Math.max(10, baseSize - 1)}px`);
  titlebar.updateBackground(TitlebarColor.fromHex(colors.background));
  titlebar.updateItemBGColor(TitlebarColor.fromHex(colors.menuSelection));
  titlebar.titlebarElement.style.backgroundColor = colors.background;
  titlebar.titlebarElement.style.borderBottom = "none";
  titlebar.titlebarElement.style.color = colors.foreground;
  titlebar.titlebarElement.classList.toggle("light", theme === "light");

  const divider = ensureTitlebarDivider();
  if (isSplash) {
    divider.style.display = "none";
  } else {
    divider.style.display = "block";
    divider.style.top = `${Math.max(0, titlebar.titlebarElement.offsetHeight || DESKTOP_TITLEBAR_HEIGHT)}px`;
    divider.style.backgroundColor = colors.border;
  }

  void ipcRenderer.invoke("desktop-shell:update-titlebar", {
    backgroundColor: isSplash ? getDesktopWindowBackground(theme) : colors.background,
    overlay: {
      color: isSplash ? themeConfig.colors.titlebar : colors.background,
      symbolColor: isSplash ? themeConfig.colors.titlebarForeground : colors.foreground,
      height: titlebar.titlebarElement.offsetHeight || DESKTOP_TITLEBAR_HEIGHT,
    },
  }).catch((error) => {
    console.warn("[desktop-preload] Failed to refresh native title bar theme:", error);
  });

  upsertTitlebarThemeStyle(theme, colors);

  if (isSplash) {
    navigationControls = null;
    setNavigationState({ canGoBack: false, canGoForward: false });
    return;
  }

  ensureNavigationControls(titlebar);
  void refreshNavigationState();
}

function getRequestedTheme(): DesktopTheme {
  return currentTheme ?? resolveDocumentTheme();
}

async function ensureTitlebar(theme = getRequestedTheme()): Promise<CustomTitlebar> {
  currentTheme = theme;

  if (!titlebarPromise) {
    const titlebarOptions: TitleBarOptions = {
      themeConfig: getDesktopTitlebarThemeConfig(theme),
      unfocusEffect: false,
    };

    titlebarPromise = document.readyState === "loading"
      ? createTitlebarOnDOMContentLoaded(titlebarOptions)
      : Promise.resolve(createTitlebar(titlebarOptions));
  }

  const titlebar = await titlebarPromise;
  applyThemeToTitlebar(titlebar, getRequestedTheme());
  return titlebar;
}

function logTitlebarInitError(error: unknown): void {
  console.warn("[desktop-preload] Failed to initialize custom title bar:", error);
}

ipcRenderer.on("desktop-shell:navigation-state-changed", (_event, nextState: unknown) => {
  if (!nextState || typeof nextState !== "object") {
    return;
  }

  setNavigationState({
    canGoBack: Boolean((nextState as Partial<NavigationState>).canGoBack),
    canGoForward: Boolean((nextState as Partial<NavigationState>).canGoForward),
  });
});

ipcRenderer.on("desktop-shell:refresh-titlebar", () => {
  void ensureTitlebar().catch(logTitlebarInitError);
});

try {
  if (document.readyState === "loading") {
    window.addEventListener("DOMContentLoaded", () => {
      void ensureTitlebar().catch(logTitlebarInitError);
    }, { once: true });
  } else {
    void ensureTitlebar().catch(logTitlebarInitError);
  }
} catch (error) {
  logTitlebarInitError(error);
}

contextBridge.exposeInMainWorld("desktopShell", {
  async retryStart() {
    await ipcRenderer.invoke("desktop-shell:retry-start");
  },
  async setTheme(theme: DesktopTheme) {
    currentTheme = theme;
    const persistPromise = ipcRenderer.invoke("desktop-shell:set-theme-preference", theme).catch((error) => {
      console.warn("[desktop-preload] Failed to persist desktop theme:", error);
      return false;
    });

    await ensureTitlebar(theme);
    await persistPromise;
  },
  initialTheme: initialTheme ?? undefined,
  isDesktop: true,
  platform: process.platform,
  titlebarHeight: DESKTOP_TITLEBAR_HEIGHT,
});
