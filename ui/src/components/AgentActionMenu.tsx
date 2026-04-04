import { useTranslation } from "react-i18next";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { MoreVertical, Pause, Play, PowerOff, Eye } from "lucide-react";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Button } from "@/components/ui/button";
import { agentsApi } from "../api/agents";
import { queryKeys } from "../lib/queryKeys";
import type { Agent } from "@penclipai/shared";

interface AgentActionMenuProps {
  agent: Agent;
  companyId: string;
}

export function AgentActionMenu({ agent, companyId }: AgentActionMenuProps) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();

  const invalidateAgent = () => {
    queryClient.invalidateQueries({ queryKey: queryKeys.agents.list(companyId) });
    queryClient.invalidateQueries({ queryKey: queryKeys.agents.detail(agent.id) });
  };

  const pauseAgent = useMutation({
    mutationFn: () => agentsApi.pause(agent.id, companyId),
    onSuccess: invalidateAgent,
  });

  const resumeAgent = useMutation({
    mutationFn: () => agentsApi.resume(agent.id, companyId),
    onSuccess: invalidateAgent,
  });

  const terminateAgent = useMutation({
    mutationFn: () => agentsApi.terminate(agent.id, companyId),
    onSuccess: invalidateAgent,
  });

  const handlePause = async () => {
    if (!window.confirm(
      t("agent.actions.pause.confirm", {
        defaultValue: `Are you sure you want to pause "${agent.name}"?`,
      })
    )) {
      return;
    }
    await pauseAgent.mutateAsync();
  };

  const handleResume = async () => {
    await resumeAgent.mutateAsync();
  };

  const handleTerminate = async () => {
    if (!window.confirm(
      t("agent.actions.terminate.confirm", {
        defaultValue: `Are you sure you want to terminate "${agent.name}"? This action cannot be undone.`,
      })
    )) {
      return;
    }
    await terminateAgent.mutateAsync();
  };

  const isPaused = agent.status === "paused";
  const isTerminated = agent.status === "terminated";

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className="h-8 w-8"
          onClick={(e) => e.stopPropagation()}
        >
          <MoreVertical className="h-4 w-4" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuItem asChild>
          <a href={`/agents/${agent.id}`}>
            <Eye className="h-4 w-4 mr-2" />
            {t("View Details", { defaultValue: "View Details" })}
          </a>
        </DropdownMenuItem>

        {!isTerminated && (
          <>
            {isPaused ? (
              <DropdownMenuItem onClick={handleResume}>
                <Play className="h-4 w-4 mr-2" />
                {t("Resume", { defaultValue: "Resume" })}
              </DropdownMenuItem>
            ) : (
              <DropdownMenuItem onClick={handlePause}>
                <Pause className="h-4 w-4 mr-2" />
                {t("Pause", { defaultValue: "Pause" })}
              </DropdownMenuItem>
            )}

            <DropdownMenuItem
              onClick={handleTerminate}
              className="text-red-600 dark:text-red-400"
            >
              <PowerOff className="h-4 w-4 mr-2" />
              {t("Terminate", { defaultValue: "Terminate" })}
            </DropdownMenuItem>
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
