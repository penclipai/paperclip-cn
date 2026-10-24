import { useTranslation } from "react-i18next";
import { translateInstant } from "@/i18n";
import { useMemo } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useParams, useSearchParams } from "@/lib/router";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { accessApi } from "../api/access";
import { ApiError } from "../api/client";
import { authApi } from "../api/auth";
import { queryKeys } from "../lib/queryKeys";

function cliAuthRetryDelay(error: unknown): number {
  const body = error instanceof ApiError && error.body && typeof error.body === "object"
    ? error.body as { details?: unknown } : null;
  const details = body?.details && typeof body.details === "object"
    ? body.details as { retryAfterSeconds?: unknown } : null;
  const milliseconds = typeof details?.retryAfterSeconds === "number" ? details.retryAfterSeconds * 1000 : Number.NaN;
  return Number.isFinite(milliseconds) && milliseconds > 0 ? Math.max(1000, milliseconds) : 60_000;
}

function isCliAuthRateLimit(error: unknown): error is ApiError {
  return error instanceof ApiError && error.status === 429;
}

export function CliAuthPage() {
  useTranslation();
  const queryClient = useQueryClient();
  const params = useParams();
  const [searchParams] = useSearchParams();
  const challengeId = (params.id ?? "").trim();
  const token = (searchParams.get("token") ?? "").trim();
  const currentPath = useMemo(
    () => `/cli-auth/${encodeURIComponent(challengeId)}${token ? `?token=${encodeURIComponent(token)}` : ""}`,
    [challengeId, token],
  );

  const sessionQuery = useQuery({
    queryKey: queryKeys.auth.session,
    queryFn: () => authApi.getSession(),
    retry: false,
  });
  const challengeQueryKey = useMemo(() => ["cli-auth-challenge", challengeId, token] as const, [challengeId, token]);
  const retryWindowEndsAt = useMemo(() => Date.now() + 10 * 60_000, [challengeId, token]);
  const challengeQuery = useQuery({
    queryKey: challengeQueryKey,
    queryFn: () => accessApi.getCliAuthChallenge(challengeId, token),
    enabled: challengeId.length > 0 && token.length > 0,
    retry: (failureCount, error) => {
      if (!isCliAuthRateLimit(error) || failureCount >= 3) return false;
      const knownChallenge = queryClient.getQueryData<{ expiresAt: string }>(challengeQueryKey);
      const knownExpiry = Date.parse(knownChallenge?.expiresAt ?? "");
      const deadline = Number.isFinite(knownExpiry) ? Math.min(knownExpiry, retryWindowEndsAt) : retryWindowEndsAt;
      return Date.now() + cliAuthRetryDelay(error) < deadline;
    },
    retryDelay: (_failureCount, error) => cliAuthRetryDelay(error),
  });

  const approveMutation = useMutation({
    mutationFn: () => accessApi.approveCliAuthChallenge(challengeId, token),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: queryKeys.auth.session });
      await challengeQuery.refetch();
    },
  });

  const cancelMutation = useMutation({
    mutationFn: () => accessApi.cancelCliAuthChallenge(challengeId, token),
    onSuccess: async () => {
      await challengeQuery.refetch();
    },
  });

  if (!challengeId || !token) {
    return <div className="mx-auto max-w-xl py-10 text-sm text-destructive">{translateInstant("cliAuth.invalidUrl")}</div>;
  }

  const waitingForRateLimit = isCliAuthRateLimit(challengeQuery.failureReason) && challengeQuery.isFetching;
  if (sessionQuery.isLoading || challengeQuery.isLoading || waitingForRateLimit) {
    return <div role="status" className="mx-auto max-w-xl py-10 text-sm text-muted-foreground">
      {waitingForRateLimit ? "Too many CLI approval requests. Retrying shortly..." : "Loading CLI auth challenge..."}
    </div>;
  }

  if (challengeQuery.error) {
    return (
      <div className="mx-auto max-w-xl py-10">
        <Card className="block p-6">
          <h1 className="text-lg font-semibold">{translateInstant("cliAuth.unavailableTitle")}</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            {challengeQuery.error instanceof Error ? challengeQuery.error.message : translateInstant("cliAuth.unavailableBody")}
          </p>
        </Card>
      </div>
    );
  }

  const challenge = challengeQuery.data;
  if (!challenge) {
    return <div className="mx-auto max-w-xl py-10 text-sm text-destructive">{translateInstant("CLI auth challenge unavailable.")}</div>;
  }

  if (challenge.status === "approved") {
    return (
      <div className="mx-auto max-w-xl py-10">
        <Card className="block p-6">
          <h1 className="text-xl font-semibold">{translateInstant("cliAuth.accessApprovedTitle")}</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            {translateInstant("The Paperclip CLI can now finish authentication on the requesting machine.")}</p>
          <p className="mt-4 text-sm text-muted-foreground">
            {translateInstant("agentDetail.commandLabel")}{" "}<span className="font-mono text-foreground">{challenge.command}</span>
          </p>
        </Card>
      </div>
    );
  }

  if (challenge.status === "cancelled" || challenge.status === "expired") {
    return (
      <div className="mx-auto max-w-xl py-10">
        <Card className="block p-6">
          <h1 className="text-xl font-semibold">
            {challenge.status === "expired" ? translateInstant("cliAuth.expiredTitle") : translateInstant("cliAuth.cancelledTitle")}
          </h1>
          <p className="mt-2 text-sm text-muted-foreground">
            {translateInstant("cliAuth.retryBody")}</p>
        </Card>
      </div>
    );
  }

  if (challenge.requiresSignIn || !sessionQuery.data) {
    return (
      <div className="mx-auto max-w-xl py-10">
        <Card className="block p-6">
          <h1 className="text-xl font-semibold">{translateInstant("cliAuth.signInRequiredTitle")}</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            {translateInstant("cliAuth.signInRequiredBody")}</p>
          <Button asChild className="mt-4">
            <Link to={`/auth?next=${encodeURIComponent(currentPath)}`}>{translateInstant("cliAuth.signInButton")}</Link>
          </Button>
        </Card>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-xl py-10">
      <Card className="block p-6">
        <h1 className="text-xl font-semibold">{translateInstant("Approve Paperclip CLI access")}</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          {translateInstant("A local Paperclip CLI process is requesting board access to this instance.")}</p>

        <div className="mt-5 space-y-3 text-sm">
          <div>
            <div className="text-muted-foreground">{translateInstant("cliAuth.command")}</div>
            <div className="font-mono text-foreground">{challenge.command}</div>
          </div>
          <div>
            <div className="text-muted-foreground">{translateInstant("cliAuth.client")}</div>
            <div className="text-foreground">{challenge.clientName ?? "paperclipai cli"}</div>
          </div>
          <div>
            <div className="text-muted-foreground">{translateInstant("cliAuth.requestedAccess")}</div>
            <div className="text-foreground">
              {challenge.requestedAccess === "instance_admin_required" ? translateInstant("cliAuth.instanceAdmin") : translateInstant("Board")}
            </div>
          </div>
          {challenge.requestedCompanyName && (
            <div>
              <div className="text-muted-foreground">{translateInstant("Requested organization")}</div>
              <div className="text-foreground">{challenge.requestedCompanyName}</div>
            </div>
          )}
        </div>

        {(approveMutation.error || cancelMutation.error) && (
          <p className="mt-4 text-sm text-destructive">
            {(approveMutation.error ?? cancelMutation.error) instanceof Error
              ? ((approveMutation.error ?? cancelMutation.error) as Error).message
              : translateInstant("cliAuth.updateFailed")}
          </p>
        )}

        {!challenge.canApprove && (
          <p className="mt-4 text-sm text-destructive">
            {translateInstant("cliAuth.instanceAdminRequired")}</p>
        )}

        <div className="mt-5 flex gap-3">
          <Button
            onClick={() => approveMutation.mutate()}
            disabled={!challenge.canApprove || approveMutation.isPending || cancelMutation.isPending}
          >
            {approveMutation.isPending ? translateInstant("cliAuth.approving") : translateInstant("cliAuth.approveButton")}
          </Button>
          <Button
            type="button"
            variant="outline"
            onClick={() => cancelMutation.mutate()}
            disabled={approveMutation.isPending || cancelMutation.isPending}
          >
            {cancelMutation.isPending ? translateInstant("Cancelling...") : translateInstant("Cancel")}
          </Button>
        </div>
      </Card>
    </div>
  );
}
