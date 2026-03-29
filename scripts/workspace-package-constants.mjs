export const WORKSPACE_SCOPE = "@penclipai/";
export const CLI_PACKAGE_NAME = "penclipai";
export const SERVER_PACKAGE_NAME = "@penclipai/server";
export const UI_PACKAGE_NAME = "@penclipai/ui";
export const SHARED_PACKAGE_NAME = "@penclipai/shared";
export const DB_PACKAGE_NAME = "@penclipai/db";
export const REPOSITORY_URL = "https://github.com/penclipai/paperclip";
export const BUGS_URL = `${REPOSITORY_URL}/issues`;

export function isWorkspacePackageName(name) {
  return name.startsWith(WORKSPACE_SCOPE);
}
