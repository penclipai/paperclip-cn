import { useCallback } from "react";
import { useMutation, useQueryClient, type UseMutationResult } from "@tanstack/react-query";
import type { IssueRetryNowOutcome, IssueRetryNowResponse } from "@penclipai/shared";
import { useTranslation } from "react-i18next";
import { ApiError } from "../api/client";
import { issuesApi } from "../api/issues";
import { useToastActions } from "../context/ToastContext";
import { queryKeys } from "../lib/queryKeys";

export type RetryNowError = {
  message: string;
  outcomeMessage: string | null;
  status: number | null;
};

type TFn = ReturnType<typeof useTranslation>["t"];

function readErrorMessage(error: unknown, t: TFn): string {
  if (error instanceof ApiError) {
    if (typeof error.message === "string" && error.message.trim().length > 0) return error.message;
    return t("retryNow.requestFailedWithStatus", {
      status: error.status,
      defaultValue: "Request failed ({{status}})",
    });
  }
  if (error instanceof Error && error.message) return error.message;
  return t("retryNow.requestFailed", { defaultValue: "The request failed. Try again in a moment." });
}

export const RETRY_NOW_OUTCOME_HEADLINE: Record<IssueRetryNowOutcome, string> = {
  promoted: "Retry promoted",
  already_promoted: "Retry already running",
  waiting: "Retry waiting",
  no_scheduled_retry: "No scheduled retry",
  gate_suppressed: "Couldn't retry now",
};

export function useRetryNowMutation(
  issueId: string | null | undefined,
): UseMutationResult<IssueRetryNowResponse, unknown, void, unknown> & {
  lastError: RetryNowError | null;
} {
  const { t } = useTranslation(undefined, { useSuspense: false });
  const queryClient = useQueryClient();
  const { pushToast } = useToastActions();

  const mutation = useMutation({
    mutationFn: () => {
      if (!issueId) throw new Error(t("retryNow.missingIssueId", { defaultValue: "Missing issue id" }));
      return issuesApi.retryScheduledRetryNow(issueId);
    },
    onSuccess: (response) => {
      if (issueId) {
        queryClient.invalidateQueries({ queryKey: queryKeys.issues.detail(issueId) });
        queryClient.invalidateQueries({ queryKey: queryKeys.issues.activity(issueId) });
        queryClient.invalidateQueries({ queryKey: queryKeys.issues.runs(issueId) });
        queryClient.invalidateQueries({ queryKey: queryKeys.issues.liveRuns(issueId) });
        queryClient.invalidateQueries({ queryKey: queryKeys.issues.activeRun(issueId) });
      }
      if (response.outcome === "promoted") {
        pushToast({
          title: t("retryNow.outcome.promoted", { defaultValue: RETRY_NOW_OUTCOME_HEADLINE.promoted }),
          body: response.message,
          tone: "success",
        });
      } else if (response.outcome === "gate_suppressed") {
        pushToast({
          title: t("retryNow.outcome.gateSuppressed", { defaultValue: RETRY_NOW_OUTCOME_HEADLINE.gate_suppressed }),
          body: response.message,
          tone: "error",
        });
      }
    },
    onError: (error) => {
      pushToast({
        title: t("issueScheduledRetry.couldNotRetryNow", { defaultValue: "Couldn't retry now" }),
        body: readErrorMessage(error, t),
        tone: "error",
      });
    },
  });

  const reset = mutation.reset;
  const wrappedReset = useCallback(() => reset(), [reset]);

  const lastError: RetryNowError | null = (() => {
    if (mutation.error) {
      const apiError = mutation.error instanceof ApiError ? mutation.error : null;
      return {
        message: readErrorMessage(mutation.error, t),
        outcomeMessage: null,
        status: apiError?.status ?? null,
      };
    }
    if (mutation.data && mutation.data.outcome === "gate_suppressed") {
      return {
        message: mutation.data.message,
        outcomeMessage: mutation.data.message,
        status: null,
      };
    }
    return null;
  })();

  return {
    ...mutation,
    reset: wrappedReset,
    lastError,
  } as UseMutationResult<IssueRetryNowResponse, unknown, void, unknown> & {
    lastError: RetryNowError | null;
  };
}
