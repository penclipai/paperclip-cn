/**
 * `@penclipai/plugin-sdk/ui` — published package subpath for the Paperclip plugin UI SDK.
 *
 * For cross-host-compatible plugin source, import UI code from
 * `@paperclipai/plugin-sdk/ui`. Do **not** import this from plugin worker code.
 *
 * The worker-side compatibility SDK is available from `@paperclipai/plugin-sdk`.
 *
 * @see PLUGIN_SPEC.md §19.0.1 — Plugin UI SDK
 * @see PLUGIN_SPEC.md §29.2 — SDK Versioning
 *
 * @example
 * ```tsx
 * // Plugin UI bundle entry (dist/ui/index.tsx)
 * import { usePluginData, usePluginAction } from "@paperclipai/plugin-sdk/ui";
 * import type { PluginWidgetProps } from "@paperclipai/plugin-sdk/ui";
 *
 * export function DashboardWidget({ context }: PluginWidgetProps) {
 *   const { data, loading, error } = usePluginData("sync-health", {
 *     companyId: context.companyId,
 *   });
 *   const resync = usePluginAction("resync");
 *
 *   if (loading) return <div>Loading…</div>;
 *   if (error) return <div>Error: {error.message}</div>;
 *
 *   return (
 *     <div style={{ display: "grid", gap: 8 }}>
 *       <strong>Synced Issues</strong>
 *       <div>{data!.syncedCount}</div>
 *       <button onClick={() => resync({ companyId: context.companyId })}>
 *         Resync Now
 *       </button>
 *     </div>
 *   );
 * }
 * ```
 */

/**
 * Bridge hooks for plugin UI components to communicate with the plugin worker.
 *
 * - `usePluginData(key, params)` — fetch data from the worker's `getData` handler
 * - `usePluginAction(key)` — get a callable that invokes the worker's `performAction` handler
 * - `useHostContext()` — read the current active company, project, entity, and user IDs
 * - `usePluginStream(channel)` — subscribe to real-time SSE events from the worker
 */
export {
  usePluginData,
  usePluginAction,
  useHostContext,
  usePluginStream,
  usePluginToast,
} from "./hooks.js";

// Bridge error and host context types
export type {
  PluginBridgeError,
  PluginBridgeErrorCode,
  PluginHostContext,
  PluginModalBoundsRequest,
  PluginRenderCloseEvent,
  PluginRenderCloseHandler,
  PluginRenderCloseLifecycle,
  PluginRenderEnvironmentContext,
  PluginLauncherBounds,
  PluginLauncherRenderEnvironment,
  PluginDataResult,
  PluginActionFn,
  PluginStreamResult,
  PluginToastTone,
  PluginToastAction,
  PluginToastInput,
  PluginToastFn,
} from "./types.js";

// Slot component prop interfaces
export type {
  PluginPageProps,
  PluginWidgetProps,
  PluginDetailTabProps,
  PluginSidebarProps,
  PluginProjectSidebarItemProps,
  PluginCommentAnnotationProps,
  PluginCommentContextMenuItemProps,
  PluginSettingsPageProps,
} from "./types.js";
