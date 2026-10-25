export type DetachedWorkspacePackage = { name: string; relativeDirectory: string };
export function resolveDeployWorkspaceClosure(repoRoot: string, entryPackageName: string): DetachedWorkspacePackage[];
export function createDetachedDeployWorkspace(options: { repoRoot: string; workspaceRoot: string; entryPackageName?: string }): DetachedWorkspacePackage[];
export function isQualifiedCopilotPlatform(platform?: string, architecture?: string): boolean;
export function resolveQualifiedCopilotMaterializerPackage(platform?: string, architecture?: string): string | null;
