/** Build the controlled git clone invocation for a managed workspace. */
export function managedWorkspaceCloneArgs(input: {
  authConfigArgs?: readonly string[];
  referencePath?: string | null;
  cloneSource: string;
  cloneTmpDir: string;
  platform?: NodeJS.Platform;
}): string[] {
  const windowsLongPaths = (input.platform ?? process.platform) === "win32";
  return [
    ...(windowsLongPaths ? ["-c", "core.longpaths=true"] : []),
    ...(input.authConfigArgs ?? []),
    ...(input.referencePath ? ["-c", "repack.updateServerInfo=false"] : []),
    "clone",
    // Persist this controlled checkout setting before its initial fetch and
    // checkout, while `-c` also covers clone setup itself.
    ...(windowsLongPaths ? ["--config", "core.longpaths=true"] : []),
    "--no-hardlinks",
    ...(input.referencePath
      ? ["--reference-if-able", input.referencePath, "--dissociate"]
      : []),
    "--",
    input.cloneSource,
    input.cloneTmpDir,
  ];
}
