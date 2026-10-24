import type { Db } from "@penclipai/db";
import { MUSE_RESOURCE_PATH } from "@penclipai/shared";
import { createPublicMcpOAuth } from "./public-mcp/oauth.js";
import { musePublicOrigin } from "./muse-setup.js";
/** Dedicated Muse mode reuses only OAuth lifecycle; it exposes no MCP executor. */
export function museOAuth(db:Db,publicOrigin?:string) {
  const origin=musePublicOrigin(publicOrigin);
  return createPublicMcpOAuth(db,{origin,resource:origin+MUSE_RESOURCE_PATH},{mode:"muse_agent"});
}
