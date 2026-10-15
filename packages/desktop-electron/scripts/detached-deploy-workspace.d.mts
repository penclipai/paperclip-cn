export type DetachedWorkspacePackage = { name: string; relativeDirectory: string };
export function resolveDeployWorkspaceClosure(repoRoot: string, entryPackageName: string): DetachedWorkspacePackage[];
export function createDetachedDeployWorkspace(options: { repoRoot: string; workspaceRoot: string; entryPackageName?: string }): DetachedWorkspacePackage[];
