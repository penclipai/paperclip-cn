import type { FinanceByKind } from "@penclipai/shared";
import { useTranslation } from "react-i18next";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { financeEventKindDisplayName, formatCents } from "@/lib/utils";

interface FinanceKindCardProps {
  rows: FinanceByKind[];
}

export function FinanceKindCard({ rows }: FinanceKindCardProps) {
  const { t } = useTranslation();

  return (
    <Card>
      <CardHeader className="px-4 pt-4 pb-1">
        <CardTitle className="text-base">{t("Financial event mix", { defaultValue: "Financial event mix" })}</CardTitle>
        <CardDescription>
          {t("Account-level charges grouped by event kind.", {
            defaultValue: "Account-level charges grouped by event kind.",
          })}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-2 px-4 pb-4 pt-3">
        {rows.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t("No finance events in this period.", { defaultValue: "No finance events in this period." })}</p>
        ) : (
          rows.map((row) => (
            <div
              key={row.eventKind}
              className="flex items-center justify-between gap-3 border border-border px-3 py-2"
            >
              <div className="min-w-0">
                <div className="truncate text-sm font-medium">{financeEventKindDisplayName(row.eventKind)}</div>
                <div className="text-xs text-muted-foreground">
                  {t("{{events}} events - {{billers}} billers", {
                    events: row.eventCount,
                    billers: row.billerCount,
                    defaultValue: `${row.eventCount} event${row.eventCount === 1 ? "" : "s"} - ${row.billerCount} biller${row.billerCount === 1 ? "" : "s"}`,
                  })}
                </div>
              </div>
              <div className="text-right tabular-nums">
                <div className="text-sm font-medium">{formatCents(row.netCents)}</div>
                <div className="text-xs text-muted-foreground">
                  {t("{{amount}} debits", {
                    amount: formatCents(row.debitCents),
                    defaultValue: `${formatCents(row.debitCents)} debits`,
                  })}
                </div>
              </div>
            </div>
          ))
        )}
      </CardContent>
    </Card>
  );
}
