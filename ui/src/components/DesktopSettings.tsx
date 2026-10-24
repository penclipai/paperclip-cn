import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { MonitorDown, Power, Bell } from "lucide-react";
import { translateInstant } from "@/i18n";
import { Button } from "@/components/ui/button";
import { ToggleSwitch } from "@/components/ui/toggle-switch";

type DesktopPreferences = {
  closeToTray: boolean;
  notificationsEnabled: boolean;
  trayAvailable: boolean;
  notificationsSupported: boolean;
};

export function DesktopSettings() {
  useTranslation();
  const [preferences, setPreferences] = useState<DesktopPreferences | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const savingRef = useRef(false);

  useEffect(() => {
    savingRef.current = saving;
  }, [saving]);

  useEffect(() => {
    const getPreferences = window.desktopShell?.getPreferences;
    if (!window.desktopShell?.isDesktop || !getPreferences) return;
    let active = true;
    let requestId = 0;
    const refresh = () => {
      const currentRequest = ++requestId;
      void getPreferences().then((loaded) => {
        if (!active || currentRequest !== requestId || savingRef.current) return;
        if (loaded) {
          setPreferences(loaded);
          setError(null);
        } else {
          setError(translateInstant("desktopSettings.unavailable"));
        }
      }).catch(() => {
        if (active && currentRequest === requestId && !savingRef.current) {
          setError(translateInstant("desktopSettings.unavailable"));
        }
      }).finally(() => {
        if (active && currentRequest === requestId) setLoading(false);
      });
    };
    refresh();
    window.addEventListener("focus", refresh);
    return () => {
      active = false;
      window.removeEventListener("focus", refresh);
    };
  }, []);

  if (!window.desktopShell?.isDesktop) return null;
  if (loading) return null;
  if (!preferences) {
    return <p className="text-sm text-muted-foreground" role="status">{error ?? translateInstant("desktopSettings.unavailable")}</p>;
  }

  function update(next: Partial<Pick<DesktopPreferences, "closeToTray" | "notificationsEnabled">>) {
    const save = window.desktopShell?.setPreferences;
    if (!save || saving) return;
    const previous = preferences;
    if (!previous) return;
    setPreferences({
      closeToTray: next.closeToTray ?? previous.closeToTray,
      notificationsEnabled: next.notificationsEnabled ?? previous.notificationsEnabled,
      trayAvailable: previous.trayAvailable,
      notificationsSupported: previous.notificationsSupported,
    });
    setError(null);
    setSaving(true);
    void save(next).then((saved) => {
      if (saved) setPreferences(saved);
      else {
        setPreferences(previous);
        setError(translateInstant("desktopSettings.saveFailed"));
      }
    }).catch(() => {
      setPreferences(previous);
      setError(translateInstant("desktopSettings.saveFailed"));
    }).finally(() => setSaving(false));
  }

  return (
    <section className="max-w-2xl space-y-4" aria-label={translateInstant("desktopSettings.title")}>
      <div className="space-y-1">
        <div className="flex items-center gap-2">
          <MonitorDown className="h-5 w-5 text-muted-foreground" />
          <h2 className="text-base font-semibold">{translateInstant("desktopSettings.title")}</h2>
        </div>
        <p className="text-sm text-muted-foreground">{translateInstant("desktopSettings.description")}</p>
      </div>

      <div className="flex items-center justify-between gap-4">
        <div className="space-y-1">
          <div className="text-sm font-medium">{translateInstant("desktopSettings.closeToTray")}</div>
          <p className="text-xs text-muted-foreground">
            {preferences.trayAvailable
              ? translateInstant("desktopSettings.closeToTrayHint")
              : translateInstant("desktopSettings.trayUnavailable")}
          </p>
        </div>
        <ToggleSwitch
          aria-label={translateInstant("desktopSettings.closeToTray")}
          checked={preferences.closeToTray}
          disabled={!preferences.trayAvailable || saving}
          onCheckedChange={(closeToTray) => update({ closeToTray })}
        />
      </div>

      <div className="flex items-center justify-between gap-4">
        <div className="space-y-1">
          <div className="flex items-center gap-2 text-sm font-medium"><Bell className="h-4 w-4" />{translateInstant("desktopSettings.notifications")}</div>
          <p className="text-xs text-muted-foreground">
            {!preferences.trayAvailable
              ? translateInstant("desktopSettings.trayUnavailable")
              : preferences.notificationsSupported
                ? translateInstant("desktopSettings.notificationsHint")
                : translateInstant("desktopSettings.notificationsUnavailable")}
          </p>
        </div>
        <ToggleSwitch
          aria-label={translateInstant("desktopSettings.notifications")}
          checked={preferences.notificationsEnabled}
          disabled={!preferences.notificationsSupported || saving}
          onCheckedChange={(notificationsEnabled) => update({ notificationsEnabled })}
        />
      </div>

      {error ? <p className="text-sm text-destructive" role="alert">{error}</p> : null}

      <div className="flex items-center justify-between gap-4 border-t border-border pt-4">
        <p className="max-w-xl text-xs text-muted-foreground">{translateInstant("desktopSettings.quitHint")}</p>
        <Button type="button" variant="outline" disabled={saving} onClick={() => void window.desktopShell?.quit?.().catch(() => setError(translateInstant("desktopSettings.saveFailed")))}>
          <Power className="size-4" />{translateInstant("desktopSettings.quit")}
        </Button>
      </div>
    </section>
  );
}
