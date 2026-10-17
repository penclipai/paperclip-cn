import type { McpConnection, McpConnectionSetup } from "@penclipai/shared";
import { api } from "./client";

export const publicMcpApi = {
  setup: () => api.get<McpConnectionSetup>("/mcp/setup"),
  connections: () => api.get<McpConnection[]>("/mcp/connections"),
  revoke: (id: string) => api.delete(`/mcp/connections/${encodeURIComponent(id)}`),
};
