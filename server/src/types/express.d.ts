import type { UiLocale } from "@penclipai/shared";

export {};

import type { AgentApiKeyScope } from "@penclipai/shared";

declare global {
  namespace Express {
    interface Request {
      locale: UiLocale;
      t: (
        key: string,
        params?: Record<string, string | number | boolean | null | undefined>,
      ) => string;
      actor: {
        type: "board" | "agent" | "none";
        userId?: string;
        userName?: string | null;
        userEmail?: string | null;
        agentId?: string;
        companyId?: string;
        companyIds?: string[];
        sessionId?: string | null;
        memberships?: Array<{
          companyId: string;
          membershipRole?: string | null;
          status?: string;
        }>;
        onBehalfOfMemberships?: Array<{
          companyId: string;
          membershipRole?: string | null;
          status?: string;
        }>;
        isInstanceAdmin?: boolean;
        keyId?: string;
        keyScope?: AgentApiKeyScope;
        runId?: string;
        onBehalfOfUserId?: string | null;
        identityContextId?: string | null;
        source?: "local_implicit" | "session" | "board_key" | "agent_key" | "agent_jwt" | "mcp_oauth" | "cloud_tenant" | "cloud_control" | "none";
      };
    }
  }
}
