import { translateInstant } from "@/i18n";
import { useTranslation } from "react-i18next";
import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { SUBSCRIPTION_CURRENCIES, centsToUsd, usdToCents, type SubscriptionAccountReport, type SubscriptionCostReport, type SubscriptionUsage } from "@penclipai/shared";
import { subscriptionsApi } from "../api/subscriptions";
import { formatCents, formatDateTime, formatTokens, providerDisplayName } from "../lib/utils";
import { Button } from "./ui/button";
import { Badge } from "./ui/badge";
import { Card } from "./ui/card";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "./ui/dialog";
import { Input } from "./ui/input";
import { Label } from "./ui/label";

export function subscriptionMoney(cents: string, currency: string) {
  return currency === "USD" ? formatCents(Number(cents))
    : new Intl.NumberFormat(undefined, { style: "currency", currency, currencyDisplay: "code" }).format(Number(cents) / 100);
}

export function SubscriptionTokenUsage({ usage }: { usage: SubscriptionUsage }) {
  useTranslation();
  return <span className="font-mono text-xs text-muted-foreground">
    {translateInstant("subscriptionCost.usageSummary", { input: formatTokens(usage.inputTokens + usage.cachedInputTokens), output: formatTokens(usage.outputTokens) })}{usage.cachedInputTokens > 0 && <span className="block">{formatTokens(usage.cachedInputTokens)} {translateInstant("input cached")}</span>}
  </span>;
}

function SubscriptionEditor({ account, accounts, companyId, onDone }: {
  account: SubscriptionAccountReport; accounts: SubscriptionAccountReport[]; companyId: string; onDone: () => void;
}) {
  useTranslation();
  const [plan, setPlan] = useState(account.price.plan);
  const [amount, setAmount] = useState(account.price.amountCents == null ? "" : centsToUsd(account.price.amountCents).replace(/\.?0+$/, ""));
  const [currency, setCurrency] = useState(account.price.currency);
  const [cadence, setCadence] = useState(account.price.cadence);
  const [status, setStatus] = useState(account.price.status);
  const [targetId, setTargetId] = useState("");
  const save = useMutation({ mutationFn: () => subscriptionsApi.update(companyId, account.id, {
    expectedRevision: account.price.revision, plan, amountCents: amount.trim() ? usdToCents(amount.trim()) : null,
    currency: currency as typeof SUBSCRIPTION_CURRENCIES[number], cadence, status,
  }), onSuccess: onDone });
  const link = useMutation({ mutationFn: () => subscriptionsApi.link(companyId, account.id, targetId, account.price.revision,
    accounts.find(row => row.id === targetId)!.price.revision), onSuccess: onDone });
  const targets = accounts.filter(row => row.id !== account.id && row.provider === account.provider && row.canEdit);
  const busy = save.isPending || link.isPending;
  const selectClass = "h-9 rounded-md border border-input bg-background px-3 text-sm";
  return <div className="space-y-5">
    <form className="space-y-4" onSubmit={event => { event.preventDefault(); save.mutate(); }}>
      <div className="space-y-2"><Label htmlFor="subscription-plan">{translateInstant("subscriptionCost.planLabel")}</Label><Input id="subscription-plan" value={plan} onChange={event => setPlan(event.target.value)} required maxLength={100} /></div>
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-2"><Label htmlFor="subscription-price">{translateInstant("Price per billing period")}</Label><Input id="subscription-price" type="number" min="0" step="any" value={amount} placeholder={translateInstant("Unknown")} onChange={event => setAmount(event.target.value)} /></div>
        <div className="space-y-2"><Label htmlFor="subscription-currency">{translateInstant("Currency")}</Label><select id="subscription-currency" className={selectClass} value={currency} onChange={event => setCurrency(event.target.value)}>{SUBSCRIPTION_CURRENCIES.map(code => <option key={code}>{code}</option>)}</select></div>
        <div className="space-y-2"><Label htmlFor="subscription-cadence">{translateInstant("Billed")}</Label><select id="subscription-cadence" className={selectClass} value={cadence} onChange={event => setCadence(event.target.value as typeof cadence)}><option value="month">{translateInstant("instanceGeneralSettings.backupRetentionMonthly")}</option><option value="year">{translateInstant("Annually")}</option></select></div>
        <div className="space-y-2"><Label htmlFor="subscription-status">{translateInstant("Tracking")}</Label><select id="subscription-status" className={selectClass} value={status} onChange={event => setStatus(event.target.value as typeof status)}><option value="active">{translateInstant("Active")}</option><option value="ended">{translateInstant("Subscription ended")}</option><option value="excluded">{translateInstant("Exclude from this organization")}</option></select></div>
      </div>
      <p className="text-xs text-muted-foreground">{translateInstant("Enter the full amount for one account or seat. Annual prices are divided by 12. Changes apply from now. Ending tracking here does not cancel your provider subscription.")}</p>
      {save.error && <p role="alert" className="text-sm text-destructive">{translateInstant("Could not save this price. Check the amount, or reopen the account if another person updated it.")}</p>}
      <div className="flex items-center justify-between"><Button type="button" variant="ghost" disabled={busy} onClick={onDone}>{translateInstant("Cancel")}</Button><Button type="submit" disabled={busy}>{save.isPending ? translateInstant("Saving…") : translateInstant("Save price")}</Button></div>
    </form>
    {targets.length > 0 && <div className="space-y-2 border-t border-border pt-4">
      <Label htmlFor="subscription-link">{translateInstant("Same subscription as another account?")}</Label>
      <select id="subscription-link" className={selectClass} value={targetId} onChange={event => setTargetId(event.target.value)}><option value="">{translateInstant("Choose an account")}</option>{targets.map(row => <option key={row.id} value={row.id}>{row.name} · {row.price.plan}</option>)}</select>
      <p className="text-xs text-muted-foreground">{translateInstant("Linking counts these accounts once, combines their Paperclip usage, and keeps the selected account’s price. Only link the same subscription or paid seat.")}</p>
      {link.error && <p role="alert" className="text-sm text-destructive">{translateInstant("Could not link these accounts. Reopen their details and try again.")}</p>}
      <Button type="button" variant="outline" disabled={!targetId || busy} onClick={() => link.mutate()}>{translateInstant("Link accounts")}</Button>
    </div>}
  </div>;
}

export function SubscriptionCostCard({ companyId, report, error, onChanged }: {
  companyId: string; report?: SubscriptionCostReport; error?: unknown; onChanged: () => void;
}) {
  useTranslation();
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<SubscriptionAccountReport | null>(null);
  const closeEditor = () => { setEditing(null); onChanged(); };
  const known = report?.monthlyTotals.length;
  const estimatedCount = report?.monthlyTotals.reduce((sum, total) => sum + total.estimatedCount, 0) ?? 0;
  return <>
    <Card className="block p-4">
      <div className="text-(length:--text-micro) uppercase tracking-(--tracking-eyebrow) text-muted-foreground">{translateInstant("Subscriptions")}</div>
      <div className="mt-2 font-mono text-2xl font-semibold tabular-nums">
        {known ? report!.monthlyTotals.map(total => <div key={total.currency}>{translateInstant("subscriptionCost.monthlyAmount", { amount: subscriptionMoney(total.amountCents, total.currency) })}</div>) : report && report.activeCount === 0 && report.accounts.length > 0 ? translateInstant("subscriptionCost.monthlyAmount", { amount: "$0.00" }) : "—"}
      </div>
      <div className="mt-1 space-y-1 text-xs text-muted-foreground">
        {report ? <>
          {estimatedCount > 0 && <div><Badge variant="outline" className="font-normal text-muted-foreground">{estimatedCount < report.activeCount - report.unknownPriceCount ? translateInstant("Partially estimated") : translateInstant("Estimated")}</Badge></div>}
          {report.unknownPriceCount > 0 && !!known && <div>{translateInstant("Known monthly subtotal")}</div>}
          <div>{report.accounts.length === 0 ? translateInstant("No visible subscriptions") : <>{translateInstant("subscriptionCost.activeCount", { count: report.activeCount })}{report.unknownPriceCount > 0 && translateInstant("subscriptionCost.unknownPriceCount", { count: report.unknownPriceCount })}</>}</div>
          {report.accounts.length > 0 && <div>{translateInstant("Monthly fees for accounts visible to you")}</div>}
          {report.unidentifiedAccountCount > 0 && <div>{translateInstant("subscriptionCost.unidentifiedAccountCount", { count: report.unidentifiedAccountCount })}</div>}
          <SubscriptionTokenUsage usage={report.subscription} />
        </> : error ? <div>{translateInstant("Subscription data is unavailable.")}</div> : <div>{translateInstant("Loading subscriptions…")}</div>}
        {report && error ? <div>{translateInstant("Showing last loaded subscription data.")}</div> : null}
      </div>
      <Button variant="link" size="sm" className="h-auto p-0" onClick={() => setOpen(true)} disabled={!report}>{translateInstant("View details")}</Button>
    </Card>
    <Dialog open={open} onOpenChange={value => { setOpen(value); if (!value) setEditing(null); }}>
      <DialogContent className="max-h-(--sz-80vh) overflow-y-auto sm:max-w-3xl">
        <DialogHeader><DialogTitle>{editing ? translateInstant("Subscription price") : translateInstant("Subscriptions")}</DialogTitle><DialogDescription>{translateInstant("Current monthly costs for accounts visible to you. Token totals cover company work in the selected period.")}</DialogDescription></DialogHeader>
        {editing ? <SubscriptionEditor key={editing.id} companyId={companyId} account={editing} accounts={report?.accounts ?? []} onDone={closeEditor} /> : <div className="space-y-4">
          {report?.accounts.length === 0 && <p className="text-sm text-muted-foreground">{translateInstant("No subscriptions are visible to you yet. Connect an AI account or run an agent with a connected subscription.")}</p>}
          {report?.accounts.map(account => <div key={account.id} className="space-y-2 border-b border-border pb-4 last:border-0">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div><div className="font-medium">{account.name}</div><div className="text-xs text-muted-foreground">{account.shared ? translateInstant("Shared") : account.ownerName ?? (account.ownerUserId ? translateInstant("Account owner") : translateInstant("Personal accounts"))} · {providerDisplayName(account.provider)} · {account.price.plan}</div></div>
              <div className="text-right"><div className="font-mono">{account.price.status !== "active" ? account.price.status === "ended" ? translateInstant("Ended") : translateInstant("Excluded") : account.price.monthlyCents == null ? translateInstant("Price unknown") : translateInstant("subscriptionCost.monthlyAmount", { amount: subscriptionMoney(account.price.monthlyCents, account.price.currency) })}</div><div className="text-xs text-muted-foreground">{account.price.source === "catalog" ? translateInstant("Estimated · before tax") : account.price.source === "user" ? translateInstant("User supplied") : ""}{account.price.cadence === "year" ? translateInstant("subscriptionCost.annualPaymentNote") : ""}</div></div>
            </div>
            <SubscriptionTokenUsage usage={account.usage} />
            {Number(account.usage.costCents) > 0 && <div className="text-xs text-muted-foreground">{formatCents(Number(account.usage.costCents))} {translateInstant("recorded usage charges in selected period, separate from the subscription fee.")}</div>}
            {account.agents.length > 0 && <div className="text-xs text-muted-foreground">{translateInstant("Used by")}{" "}{account.agents.map(agent => agent.name).join(", ")}</div>}
            {!account.identityVerified && <p className="text-xs text-muted-foreground">{translateInstant("Account identity is unconfirmed. Link duplicates if these connections use the same subscription.")}</p>}
            {account.observedAt && <div className="text-xs text-muted-foreground">{translateInstant(account.refreshStatus === "unavailable" ? "subscriptionCost.planCheckedUnavailable" : "subscriptionCost.planChecked", { checkedAt: formatDateTime(account.observedAt) })}</div>}
            {account.refreshStatus === "unavailable" && !account.observedAt && <p className="text-xs text-muted-foreground">{translateInstant("The provider did not make plan details available. You can enter the price yourself.")}</p>}
            {account.canEdit && <div><Button variant="outline" size="sm" onClick={() => setEditing(account)}>{translateInstant("Edit price")}</Button></div>}
          </div>)}
          {!!report?.unattributedSubscription.eventCount && <p className="text-xs text-muted-foreground">{translateInstant("Some subscription usage has no recorded account. It is included in the subscription token total.")}</p>}
          <p className="text-xs text-muted-foreground">{translateInstant("Monthly fees cover the whole account, including use outside Paperclip. They are separate from recorded charges and agent budgets. Currencies are totaled separately.")}</p>
        </div>}
      </DialogContent>
    </Dialog>
  </>;
}
