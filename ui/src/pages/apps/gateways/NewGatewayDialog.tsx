import { type FormEvent, useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import type { ToolMcpGatewayContextScopeType, ToolProfileWithDetails } from "@penclipai/shared";
import { toolsApi } from "@/api/tools";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useToast } from "@/context/ToastContext";
import { queryKeys } from "@/lib/queryKeys";
import { allowedToolsLabel } from "./gateway-helpers";
import { describeError } from "@/api/errors";

export const gatewaysQueryKey = (companyId: string) => ["tools", "gateways", companyId] as const;

/**
 * "New gateway" dialog. A gateway is one safe MCP endpoint that exposes only
 * the tools in its access profile. Matches the prosumer create flow from the
 * PAP-11178 design of record.
 */
export function NewGatewayDialog({
  companyId,
  open,
  onOpenChange,
  onCreated,
}: {
  companyId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreated?: (gatewayId: string) => void;
}) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const { pushToast } = useToast();
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [profileId, setProfileId] = useState("");

  const profilesQuery = useQuery({
    queryKey: queryKeys.tools.profiles(companyId),
    queryFn: () => toolsApi.listProfiles(companyId),
    enabled: open,
  });
  const activeProfiles = (profilesQuery.data?.profiles ?? []).filter(
    (profile: ToolProfileWithDetails) => profile.status !== "archived",
  );

  useEffect(() => {
    if (open && !profileId && activeProfiles[0]) setProfileId(activeProfiles[0].id);
  }, [open, profileId, activeProfiles]);

  const createMutation = useMutation({
    mutationFn: () =>
      toolsApi.createGateway(companyId, {
        name: name.trim(),
        description: description.trim() || null,
        profileId,
        defaultProfileMode: "gateway_only",
        contextScopeType: "company" satisfies ToolMcpGatewayContextScopeType,
      }),
    onSuccess: async (gateway) => {
      pushToast({
        title: t("apps.gateways.newGateway.toast.createdTitle", { defaultValue: "Gateway created" }),
        body: gateway.name,
        tone: "success",
      });
      await queryClient.invalidateQueries({ queryKey: gatewaysQueryKey(companyId) });
      setName("");
      setDescription("");
      onOpenChange(false);
      onCreated?.(gateway.id);
    },
    onError: (error) => {
      pushToast({
        title: t("apps.gateways.newGateway.toast.createFailedTitle", {
          defaultValue: "Gateway was not created",
        }),
        body: describeError(error).body,
        tone: "error",
      });
    },
  });

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!name.trim() || !profileId) return;
    createMutation.mutate();
  }

  const profilesLoading = profilesQuery.isLoading;
  const noProfiles = !profilesLoading && activeProfiles.length === 0;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{t("apps.gateways.newGateway.title", { defaultValue: "New gateway" })}</DialogTitle>
          <DialogDescription>
            {t("apps.gateways.newGateway.description", {
              defaultValue:
                "One safe MCP endpoint that exposes only the apps in its access profile. Hand it to a client like Cursor or Claude Desktop.",
            })}
          </DialogDescription>
        </DialogHeader>
        <form className="space-y-4" onSubmit={submit}>
          <label className="block space-y-1.5">
            <span className="text-xs font-medium text-muted-foreground">
              {t("apps.gateways.newGateway.nameLabel", { defaultValue: "Name" })}
            </span>
            <Input
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder={t("apps.gateways.newGateway.namePlaceholder", { defaultValue: "CTO agents" })}
              required
              autoFocus
            />
          </label>
          <label className="block space-y-1.5">
            <span className="text-xs font-medium text-muted-foreground">
              {t("apps.gateways.newGateway.profileLabel", { defaultValue: "Access profile" })}
            </span>
            <select
              className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
              value={profileId}
              onChange={(event) => setProfileId(event.target.value)}
              required
              disabled={noProfiles}
            >
              <option value="" disabled>
                {profilesLoading
                  ? t("apps.gateways.newGateway.loadingProfiles", { defaultValue: "Loading profiles…" })
                  : t("apps.gateways.newGateway.chooseProfile", { defaultValue: "Choose a profile" })}
              </option>
              {activeProfiles.map((profile) => (
                <option key={profile.id} value={profile.id}>
                  {profile.name} — {formatAllowedToolsSummary(profile, t)}
                </option>
              ))}
            </select>
            <span className="text-xs text-muted-foreground">
              {t("apps.gateways.newGateway.profileHelp", {
                defaultValue: "The profile decides which tools this gateway allows. You can change it later.",
              })}
            </span>
          </label>
          <label className="block space-y-1.5">
            <span className="text-xs font-medium text-muted-foreground">
              {t("apps.gateways.newGateway.descriptionLabel", { defaultValue: "Description (optional)" })}
            </span>
            <textarea
              className="min-h-16 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
              value={description}
              onChange={(event) => setDescription(event.target.value)}
              placeholder={t("apps.gateways.newGateway.descriptionPlaceholder", {
                defaultValue: "Who this endpoint is for and when it should be rotated.",
              })}
            />
          </label>
          {noProfiles ? (
            <p className="text-xs text-destructive">
              {t("apps.gateways.newGateway.noProfiles", {
                defaultValue: "Create an access profile under Advanced before adding a gateway.",
              })}
            </p>
          ) : null}
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
              {t("apps.gateways.newGateway.cancel", { defaultValue: "Cancel" })}
            </Button>
            <Button
              type="submit"
              disabled={createMutation.isPending || noProfiles || !name.trim() || !profileId}
            >
              {createMutation.isPending
                ? t("apps.gateways.newGateway.creating", { defaultValue: "Creating…" })
                : t("apps.gateways.newGateway.create", { defaultValue: "Create gateway" })}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function formatAllowedToolsSummary(
  profile: ToolProfileWithDetails | undefined,
  t: (key: string, options?: Record<string, unknown>) => string,
): string {
  if (!profile) {
    return t("apps.gateways.common.profileUnavailable", { defaultValue: "Profile unavailable" });
  }
  const { accessMode, allowedToolCount, totalToolCount, excludedToolCount } = profile.summary;
  const count = accessMode === "all_except" ? Math.max(totalToolCount - excludedToolCount, 0) : allowedToolCount;
  if (count === 0) {
    return t("apps.gateways.common.noToolsAllowed", { defaultValue: "No tools allowed" });
  }
  return t("apps.gateways.common.toolsCount", {
    count,
    defaultValue: count === 1 ? "{{count}} tool" : "{{count}} tools",
  });
}
