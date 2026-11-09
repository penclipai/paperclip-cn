import { translateInstant } from "@/i18n";
import { useTranslation } from "react-i18next";
import { useQuery } from "@tanstack/react-query";
import { Activity } from "lucide-react";
import { routinesApi } from "@/api/routines";
import { EmptyState } from "@/components/EmptyState";
import { useQueryView } from "@/components/QueryView";
import { RoutineActivityRow } from "@/components/RoutineActivityRow";
import { Button } from "@/components/ui/button";
import { queryKeys } from "@/lib/queryKeys";

export function RoutineAuditActivity({
  companyId,
  routineId,
}: {
  companyId: string;
  routineId: string;
}) {
  useTranslation();
  const activity = useQuery({
    queryKey: [...queryKeys.routines.activity(companyId, routineId), "audit"],
    queryFn: async () => {
      const [routine, runs] = await Promise.all([
        routinesApi.get(routineId),
        routinesApi.listRuns(routineId, 200),
      ]);
      return routinesApi.activity(companyId, routineId, {
        triggerIds: routine.triggers.map((trigger) => trigger.id),
        runIds: runs.map((run) => run.id),
      });
    },
  });
  const activityView = useQueryView(activity);

  // A loaded feed stays on screen through a failed refetch; an outage before
  // the first load reads as loading, and only a real failure shows copy.
  if (activityView.kind === "loading" || activityView.kind === "reconnecting") {
    return (
      <div className="border-y border-border py-14 text-center text-sm text-muted-foreground">
        {translateInstant("Loading routine activity…")}</div>
    );
  }

  if (activityView.kind === "error") {
    return (
      <div className="flex flex-col items-center gap-3 border-y border-border py-14 text-center">
        <p className="text-sm text-muted-foreground">
          {activity.error instanceof Error ? activity.error.message : "Failed to load routine activity."}
        </p>
        <Button variant="outline" size="sm" onClick={() => activity.refetch()}>
          {translateInstant("Try again")}</Button>
      </div>
    );
  }

  const events = activityView.data ?? [];
  if (events.length === 0) {
    return <EmptyState icon={Activity} message={translateInstant("No routine activity yet.")} />;
  }

  return (
    <div className="border-y border-border" aria-label={translateInstant("Routine activity")}>
      {events.map((event) => (
        <RoutineActivityRow key={event.id} event={event} />
      ))}
    </div>
  );
}
