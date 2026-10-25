export {};

declare global {
  interface Window {
    desktopShell?: {
      retryStart(): Promise<void>;
      setTheme(theme: "light" | "dark"): Promise<void>;
      getPreferences?(): Promise<{
        closeToTray: boolean;
        notificationsEnabled: boolean;
        trayAvailable: boolean;
        notificationsSupported: boolean;
      } | null>;
      setPreferences?(preferences: {
        closeToTray?: boolean;
        notificationsEnabled?: boolean;
      }): Promise<{
        closeToTray: boolean;
        notificationsEnabled: boolean;
        trayAvailable: boolean;
        notificationsSupported: boolean;
      } | null>;
      setContext?(context: {
        locale: "zh-CN" | "en";
        companyId: string | null;
        activeRuns: number | null;
      }): Promise<boolean>;
      notify?(notification: {
        id: string;
        companyId: string;
        kind: "approval" | "run_failed" | "run_timed_out";
        targetPath: string;
      }): Promise<boolean>;
      quit?(): Promise<boolean>;
      onNavigate?(callback: (path: string) => void): () => void;
      initialTheme?: "light" | "dark";
      isDesktop: boolean;
      platform: string;
      titlebarHeight: number;
    };
  }
}
