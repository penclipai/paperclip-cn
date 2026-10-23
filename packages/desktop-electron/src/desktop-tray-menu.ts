import type { MenuItemConstructorOptions } from "electron";
import { desktopText } from "./desktop-copy.js";

/** Native menu composition stays separate from application/worker lifetime. */
export function desktopTrayMenu(input: {
  locale: string;
  closeToTray: boolean;
  notificationsEnabled: boolean;
  notificationsSupported: boolean;
  open(): void;
  settings(): void;
  setPreference(patch: { closeToTray?: boolean; notificationsEnabled?: boolean }): void;
  quit(): void;
}): MenuItemConstructorOptions[] {
  return [
    { label: desktopText("desktop.tray.open", input.locale), click: input.open },
    { label: desktopText("desktop.tray.settings", input.locale), click: input.settings },
    { type: "separator" },
    {
      label: desktopText("desktop.tray.closeToTray", input.locale),
      type: "checkbox", checked: input.closeToTray,
      click: (item) => input.setPreference({ closeToTray: item.checked }),
    },
    {
      label: desktopText("desktop.tray.notifications", input.locale),
      type: "checkbox", checked: input.notificationsEnabled,
      enabled: input.notificationsSupported,
      click: (item) => input.setPreference({ notificationsEnabled: item.checked }),
    },
    { type: "separator" },
    { label: desktopText("desktop.tray.quit", input.locale), click: input.quit },
  ];
}
