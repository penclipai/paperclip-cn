import { useState } from "react";
import type { AiConnectionBinding } from "@penclipai/shared";
import { useTranslation } from "react-i18next";
import { AiProviderSetup } from "../ai-connections/AiProviderSetup";
import { Button } from "../ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "../ui/dialog";

export function OnboardingGatewaySetup({
  companyId,
  agentId,
  environmentId,
  adapterType,
  disabled,
  onComplete,
}: {
  companyId: string;
  agentId?: string;
  environmentId?: string;
  adapterType: "codex_local" | "claude_local";
  disabled?: boolean;
  onComplete: (binding: Exclude<AiConnectionBinding, { mode: "responsible_user" }>) => void;
}) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  return <>
    <Button type="button" variant="ghost" disabled={disabled} onClick={() => setOpen(true)}>
      {t("gatewaySetup.useCustom", { defaultValue: "Use a custom gateway" })}
    </Button>
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent className="max-h-(--sz-85vh) overflow-y-auto sm:max-w-2xl" onKeyDown={event => event.stopPropagation()}>
        <DialogHeader>
          <DialogTitle>{t("gatewaySetup.title", { defaultValue: "Custom gateway connection" })}</DialogTitle>
          <DialogDescription>{t("gatewaySetup.description", { defaultValue: "Save the connection, then choose a model and test it with your agent." })}</DialogDescription>
        </DialogHeader>
        <AiProviderSetup companyId={companyId} agentId={agentId} environmentId={environmentId}
          initialProvider="gateway" initialProtocol={adapterType === "codex_local" ? "responses" : "messages"}
          submitLabel={t("gatewaySetup.saveConnection", { defaultValue: "Save connection" })} onCancel={() => setOpen(false)}
          onComplete={binding => { setOpen(false); onComplete(binding); }} />
      </DialogContent>
    </Dialog>
  </>;
}
