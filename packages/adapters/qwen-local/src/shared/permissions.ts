export function hasQwenApprovalModeArg(args: readonly string[]): boolean {
  return args.some(
    (arg) =>
      arg === "-y" ||
      arg === "--yolo" ||
      arg === "--approval-mode" ||
      arg.startsWith("--approval-mode="),
  );
}
