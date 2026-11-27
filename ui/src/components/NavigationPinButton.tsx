import { Pin, PinOff } from "lucide-react";
import { useTranslation } from "react-i18next";
import { cn } from "@/lib/utils";
import type { usePinnedNavigation } from "@/hooks/usePinnedNavigation";

export type PinControls = Pick<ReturnType<typeof usePinnedNavigation>, "keys" | "canPin" | "toggle">;

interface NavigationPinButtonProps {
  pinKey: string;
  label: string;
  pins: PinControls;
  className: string;
}

export function NavigationPinButton({ pinKey, label, pins, className }: NavigationPinButtonProps) {
  const { t } = useTranslation();
  const pinned = pins.keys.has(pinKey);
  const Icon = pinned ? PinOff : Pin;
  const action = pinned
    ? t("nav.unpinItem", { label, defaultValue: "Unpin {{label}}" })
    : t("nav.pinItem", { label, defaultValue: "Pin {{label}}" });

  return (
    <button
      type="button"
      aria-label={action}
      title={pinned
        ? t("nav.unpinFromSidebar", { label, defaultValue: "Unpin {{label}} from sidebar" })
        : t("nav.pinToSidebar", { label, defaultValue: "Pin {{label}} to sidebar" })}
      aria-pressed={pinned}
      disabled={!pins.canPin}
      onClick={(event) => {
        event.preventDefault();
        event.stopPropagation();
        pins.toggle(pinKey);
      }}
      className={cn(
        "flex items-center justify-center rounded-md outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring",
        pinned ? "text-foreground" : "text-muted-foreground",
        className,
      )}
    >
      <Icon aria-hidden className="size-3.5" />
    </button>
  );
}
