import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import {
  BarChart3,
  Bot,
  Check,
  Code,
  Database,
  FileText,
  LayoutGrid,
  MessageCircle,
  ShoppingBag,
  SquareCheck,
  TriangleAlert,
  Plus,
  type LucideIcon,
} from "lucide-react";
import { translateInstant } from "@/i18n";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { AppLogo } from "./AppLogo";

export type PluginTileState = "available" | "connected" | "attention";

export type PluginTileAction = {
  label: string;
  disabled?: boolean;
  title?: string;
  onSelect: () => void;
};

const CORNER = "relative z-10 grid size-8 shrink-0 place-items-center rounded-lg";

function StatusMark({ state, label }: { state: Exclude<PluginTileState, "available">; label: string }) {
  const attention = state === "attention";
  const Icon = attention ? TriangleAlert : Check;
  return (
    <span
      title={label}
      className={cn(CORNER, attention ? "bg-(--status-task-todo)/15 text-(--status-task-icon-todo)" : "bg-(--status-task-done)/15 text-(--status-task-icon-done)")}
    >
      <Icon className="size-4" aria-hidden />
      <span className="sr-only">{label}</span>
    </span>
  );
}

/** One catalog entry in the Plugins marketplace: logo, name, a corner status or connect control, and a short description. */
export function PluginTile({
  slug,
  name,
  description,
  brandKey,
  logoUrl,
  darkLogoUrl,
  state,
  statusLabel,
  action,
  onOpen,
  icon,
}: {
  slug: string;
  name: string;
  description: string;
  brandKey: string;
  logoUrl?: string | null;
  darkLogoUrl?: string | null;
  state: PluginTileState;
  statusLabel: string;
  action: PluginTileAction | null;
  onOpen: () => void;
  /** Replaces the brand logo for an entry that is not a catalog app. */
  icon?: ReactNode;
}) {
  const { t } = useTranslation();
  const installed = state !== "available";
  return (
    <div
      role="listitem"
      data-app-slug={slug}
      data-connected={installed ? "true" : "false"}
      className="group relative flex min-w-0 flex-col gap-3 rounded-2xl bg-muted/50 p-5 transition-colors hover:bg-muted"
    >
      <div className="flex min-h-8 items-center gap-3">
        {icon ?? <AppLogo name={name} brandKey={brandKey} logoUrl={logoUrl} darkLogoUrl={darkLogoUrl} size={32} compact className="bg-transparent" />}
        <h3 className="min-w-0 flex-1 truncate text-sm font-semibold text-foreground">
          <button
            type="button"
            title={name}
            className="block max-w-full truncate text-left outline-none after:absolute after:inset-0 after:rounded-2xl focus-visible:after:ring-2 focus-visible:after:ring-ring"
            onClick={onOpen}
          >
            {name}
          </button>
        </h3>
        {action ? (
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className={cn(
              CORNER,
              "bg-foreground/5 hover:bg-foreground/10",
              installed && "opacity-0 transition-opacity group-hover:opacity-100 focus-visible:opacity-100",
            )}
            disabled={action.disabled}
            title={action.title ?? t("apps.plugins.actionTitle", { action: action.label, name, defaultValue: `${action.label} ${name}` })}
            aria-label={t("apps.plugins.actionTitle", { action: action.label, name, defaultValue: `${action.label} ${name}` })}
            onClick={action.onSelect}
          >
            <Plus aria-hidden />
          </Button>
        ) : null}
        {installed ? <StatusMark state={state} label={statusLabel} /> : null}
      </div>
      <p className="line-clamp-2 min-h-10 text-sm leading-5 text-muted-foreground">{description}</p>
    </div>
  );
}

export const PLUGIN_GRID = "grid gap-3 sm:grid-cols-2 xl:grid-cols-3";

/** A titled block of plugin tiles. A category block also shows how many plugins it holds and links to all of them. */
export function PluginShelf({ id, title, count, onSeeAll, children }: { id: string; title: string; count?: number; onSeeAll?: () => void; children: ReactNode }) {
  const { t } = useTranslation();
  return (
    <section id={id} aria-labelledby={`${id}-title`} className="flex scroll-mt-6 flex-col gap-3">
      <div className="flex min-h-8 items-center justify-between gap-4">
        <h2 id={`${id}-title`} className="text-base font-semibold text-foreground">
          {title}
          {count === undefined ? null : <span className="font-normal text-muted-foreground tabular-nums"> ({count.toLocaleString()})</span>}
        </h2>
        {onSeeAll ? (
          <Button type="button" variant="ghost" size="sm" className="-mr-3 h-8 text-muted-foreground" aria-label={t("apps.plugins.seeAllAria", { title, defaultValue: `See all ${title}` })} onClick={onSeeAll}>
            {t("apps.plugins.seeAll", { defaultValue: "See all" })}
          </Button>
        ) : null}
      </div>
      <div className={PLUGIN_GRID}>{children}</div>
    </section>
  );
}

export const PLUGIN_CATEGORY_ORDER = ["productivity", "developer", "communication", "ai", "data", "analytics", "content", "commerce", "other"] as const;
export type PluginCategoryId = (typeof PLUGIN_CATEGORY_ORDER)[number];

export const PLUGIN_CATEGORIES: Record<PluginCategoryId, { label: string; icon: LucideIcon }> = {
  productivity: { get label() { return translateInstant("apps.plugins.categories.productivity", { defaultValue: "Productivity" }); }, icon: SquareCheck },
  developer: { get label() { return translateInstant("apps.plugins.categories.developer", { defaultValue: "Developer tools" }); }, icon: Code },
  communication: { get label() { return translateInstant("apps.plugins.categories.communication", { defaultValue: "Communication" }); }, icon: MessageCircle },
  ai: { get label() { return translateInstant("apps.plugins.categories.ai", { defaultValue: "AI models & agents" }); }, icon: Bot },
  data: { get label() { return translateInstant("apps.plugins.categories.data", { defaultValue: "Data" }); }, icon: Database },
  analytics: { get label() { return translateInstant("apps.plugins.categories.analytics", { defaultValue: "Analytics" }); }, icon: BarChart3 },
  content: { get label() { return translateInstant("apps.plugins.categories.content", { defaultValue: "Content" }); }, icon: FileText },
  commerce: { get label() { return translateInstant("apps.plugins.categories.commerce", { defaultValue: "Commerce" }); }, icon: ShoppingBag },
  other: { get label() { return translateInstant("Other"); }, icon: LayoutGrid },
};

export const pluginCategoryId = (categories: readonly string[] | undefined): PluginCategoryId => {
  const first = categories?.[0];
  return first && first in PLUGIN_CATEGORIES ? (first as PluginCategoryId) : "other";
};

export const pluginCategorySectionId = (id: PluginCategoryId) => `plugins-category-${id}`;

export const isPluginCategoryId = (value: string | undefined): value is PluginCategoryId => Boolean(value) && value! in PLUGIN_CATEGORIES;

/** List of the categories that have plugins; each opens that category's own page. */
export function PluginCategories({ categories, onOpen }: { categories: PluginCategoryId[]; onOpen: (id: PluginCategoryId) => void }) {
  const { t } = useTranslation();
  if (categories.length === 0) return null;
  return (
    <nav aria-labelledby="plugins-categories-title" className="flex flex-col gap-3">
      <h2 id="plugins-categories-title" className="text-base font-semibold text-foreground">
        {t("Categories")}
      </h2>
      <ul className="-mx-2 grid gap-x-6 sm:grid-cols-2 lg:grid-cols-4">
        {categories.map((id) => {
          const { label, icon: Icon } = PLUGIN_CATEGORIES[id];
          return (
            <li key={id} className="min-w-0">
              <button
                type="button"
                className="flex h-10 w-full min-w-0 items-center gap-3 rounded-lg px-2 text-left text-sm text-foreground outline-none hover:bg-muted/50 focus-visible:ring-2 focus-visible:ring-ring"
                onClick={() => onOpen(id)}
              >
                <Icon className="size-4 shrink-0 text-muted-foreground" aria-hidden />
                <span className="min-w-0 flex-1 truncate">{label}</span>
              </button>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
