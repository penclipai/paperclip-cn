import { translateInstant } from "@/i18n";
import { useTranslation } from "react-i18next";
import type { CostByUserReport } from "@penclipai/shared";
import { CostAmount } from "./CostAmount";
import { Identity } from "./Identity";
import { Card, CardContent, CardHeader, CardTitle } from "./ui/card";
import { formatTokens } from "../lib/utils";

export function CostByUserTable({ report }: { report: CostByUserReport }) {
  useTranslation();
  return (
    <Card className="gap-3 py-4">
      <CardHeader className="gap-0 px-5">
        <CardTitle className="text-base">{translateInstant("By user")}</CardTitle>
      </CardHeader>
      <CardContent className="px-5">
        <div className="overflow-x-auto">
          <table aria-label={translateInstant("Costs by user")} className="w-full text-sm">
            <thead className="text-muted-foreground">
              <tr className="border-b border-border">
                <th scope="col" className="py-2 pr-4 text-left font-medium">{translateInstant("User")}</th>
                <th scope="col" className="px-4 py-2 text-right font-medium">{translateInstant("Runs")}</th>
                <th scope="col" className="px-4 py-2 text-right font-medium">{translateInstant("Input")}</th>
                <th scope="col" className="px-4 py-2 text-right font-medium">{translateInstant("Output")}</th>
                <th scope="col" className="py-2 pl-4 text-right font-medium">{translateInstant("Cost")}</th>
              </tr>
            </thead>
            <tbody>
              {report.rows.length === 0 && (
                <tr><td colSpan={5} className="py-3 text-muted-foreground">{translateInstant("No user-attributed costs yet.")}</td></tr>
              )}
              {report.rows.map(row => (
                <tr key={row.userId ?? "unattributed"} className="border-b border-border last:border-0">
                  <th scope="row" className="py-3 pr-4 text-left font-normal">
                    {row.userId ? <Identity name={row.userName ?? "Unknown user"} avatarUrl={row.userImage} /> : "Unattributed"}
                  </th>
                  <td className="px-4 py-3 text-right tabular-nums">{row.runCount.toLocaleString()}</td>
                  <td className="px-4 py-3 text-right tabular-nums">
                    {formatTokens(row.inputTokens + row.cachedInputTokens)}
                    {row.cachedInputTokens > 0 && <div className="whitespace-nowrap text-xs text-muted-foreground">{formatTokens(row.cachedInputTokens)} {translateInstant("cached")}</div>}
                  </td>
                  <td className="px-4 py-3 text-right tabular-nums">{formatTokens(row.outputTokens)}</td>
                  <td className="py-3 pl-4 text-right tabular-nums">
                    <CostAmount costCents={row.costCents} eventCount={row.eventCount} estimatedEventCount={row.estimatedEventCount} unpricedEventCount={row.unpricedEventCount} />
                    {row.unpricedEventCount > 0 && <div className="whitespace-nowrap text-xs text-muted-foreground">{row.unpricedEventCount}{" "}{translateInstant("unpriced")}{" "}{row.unpricedEventCount === 1 ? "charge" : "charges"}</div>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {report.rows.some(row => row.userId === null) && (
          <p className="mt-3 text-xs text-muted-foreground">{translateInstant("Unattributed costs have no recorded user in this organization.")}</p>
        )}
      </CardContent>
    </Card>
  );
}
