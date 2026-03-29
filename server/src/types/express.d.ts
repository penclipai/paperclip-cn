import type { UiLocale } from "@penclipai/shared";

export {};

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
        agentId?: string;
        companyId?: string;
        companyIds?: string[];
        isInstanceAdmin?: boolean;
        keyId?: string;
        runId?: string;
        source?: "local_implicit" | "session" | "board_key" | "agent_key" | "agent_jwt" | "none";
      };
    }
  }
}
