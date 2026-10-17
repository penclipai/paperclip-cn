import type { ReactNode } from "react";
import type { CostByAgent } from "@penclipai/shared";
import { formatCents } from "../lib/utils";
import { CostEstimateLabel } from "./CostEstimateLabel";
import { Badge } from "./ui/badge";
import { translateInstant } from "@/i18n";
import { useTranslation } from "react-i18next";

export function CostAmount({
  costCents,
  eventCount,
  estimatedEventCount,
  unpricedEventCount,
  showUnavailableCount = false,
  suffix,
}: Pick<CostByAgent, "costCents"> & Partial<Pick<CostByAgent, "eventCount" | "estimatedEventCount">> & {
  unpricedEventCount?: number;
  showUnavailableCount?: boolean;
  suffix?: ReactNode;
}) {
  useTranslation();
  const entirelyUnpriced = costCents === 0 && (eventCount ?? 0) > 0 && unpricedEventCount === eventCount;
  return (
    <div className="flex flex-col items-end gap-1 text-right">
      <div className="whitespace-nowrap font-mono font-medium tabular-nums">
        {entirelyUnpriced ? "—" : formatCents(costCents)}
        {suffix}
      </div>
      <CostEstimateLabel eventCount={eventCount} estimatedEventCount={estimatedEventCount} />
      {showUnavailableCount && !!unpricedEventCount && <Badge variant="outline" className="font-normal text-muted-foreground">
        {translateInstant("costDataQuality.unavailableCostCount", { count: unpricedEventCount, costLabel: unpricedEventCount === 1 ? "cost" : "costs" })}
      </Badge>}
    </div>
  );
}
