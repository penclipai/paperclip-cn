import { describe, expect, it } from "vitest";
import { managedWorkspaceCloneArgs } from "./managed-repository-checkout-args.js";

describe("managedWorkspaceCloneArgs", () => {
  it("enables and persists core.longpaths for Windows clones", () => {
    expect(managedWorkspaceCloneArgs({
      cloneSource: "C:\\repos\\source",
      cloneTmpDir: "C:\\repos\\target.clone",
      platform: "win32",
    })).toEqual([
      "-c", "core.longpaths=true", "clone", "--config", "core.longpaths=true",
      "--no-hardlinks", "--", "C:\\repos\\source", "C:\\repos\\target.clone",
    ]);
  });
});
