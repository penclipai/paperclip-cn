import { type ComponentProps, useState } from "react";
import { useTranslation } from "react-i18next";
import { Check, Languages } from "lucide-react";
import { normalizeUiLocale } from "@penclipai/shared";
import { cn } from "../lib/utils";
import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";

type LanguageSwitcherProps = {
  disablePortal?: boolean;
  align?: ComponentProps<typeof PopoverContent>["align"];
  side?: ComponentProps<typeof PopoverContent>["side"];
  sideOffset?: number;
  triggerClassName?: string;
  contentClassName?: string;
};

export function LanguageSwitcher({
  disablePortal = false,
  align = "end",
  side,
  sideOffset = 10,
  triggerClassName,
  contentClassName,
}: LanguageSwitcherProps) {
  const { t, i18n } = useTranslation();
  const currentLanguage = normalizeUiLocale(i18n.resolvedLanguage ?? i18n.language);
  const [open, setOpen] = useState(false);

  const localeOptions = [
    { value: "zh-CN", nativeLabel: t("language.zh-CN") },
    { value: "en", nativeLabel: t("language.en") },
  ] as const;

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          aria-label={t("layout.languageSwitcherLabel")}
          title={t("layout.languageSwitcherLabel")}
          className={cn(
            "group text-muted-foreground shrink-0",
            triggerClassName,
          )}
        >
          <Languages className="h-4 w-4 transition-transform duration-200 group-hover:scale-105" />
        </Button>
      </PopoverTrigger>
      <PopoverContent
        disablePortal={disablePortal}
        align={align}
        side={side}
        sideOffset={sideOffset}
        className={cn(
          "w-44 rounded-2xl border-border/70 bg-background/92 p-1.5 shadow-xl backdrop-blur-xl",
          contentClassName,
        )}
      >
        <div className="px-2.5 py-1 text-[10px] font-medium uppercase tracking-[0.16em] text-muted-foreground">
          {t("layout.languageSwitcherLabel")}
        </div>
        <div className="space-y-1">
          {localeOptions.map((option) => {
            const selected = currentLanguage === option.value;
            return (
              <button
                key={option.value}
                type="button"
                onClick={() => {
                  void i18n.changeLanguage(option.value);
                  setOpen(false);
                }}
                className={cn(
                  "flex w-full items-center justify-between rounded-xl px-2.5 py-2 text-sm transition-colors",
                  selected
                    ? "bg-accent text-foreground"
                    : "text-muted-foreground hover:bg-accent/60 hover:text-foreground",
                )}
              >
                <span>{option.nativeLabel}</span>
                {selected ? <Check className="h-3.5 w-3.5" /> : null}
              </button>
            );
          })}
        </div>
      </PopoverContent>
    </Popover>
  );
}
