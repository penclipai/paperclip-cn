import { translateInstant } from "@/i18n";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";

export function AiConnectionLegacyNotice({
  onAdopt,
  readOnly = false,
}: {
  onAdopt: () => void;
  readOnly?: boolean;
}) {
  useTranslation();
  return (
    <div className="flex flex-col gap-3 rounded-lg border border-border p-4">
      <h3 className="text-sm font-semibold">
        {translateInstant("Existing authentication — not managed by Connections")}</h3>
      <p className="text-sm text-muted-foreground">
        {translateInstant("This agent keeps its current authentication until you choose and test a managed connection. Confirm the account and who may use it before adopting.")}</p>
      {!readOnly && (
        <Button variant="outline" className="self-start" onClick={onAdopt}>
          {translateInstant("Choose a managed connection")}</Button>
      )}
    </div>
  );
}
