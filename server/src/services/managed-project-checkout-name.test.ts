import { describe, expect, it } from "vitest";
import { deriveRepoNameFromRepoUrl } from "./managed-project-checkout-name.js";

describe("deriveRepoNameFromRepoUrl", () => {
  it("uses the repository basename for Windows drive-qualified sources", () => {
    expect(deriveRepoNameFromRepoUrl("C:\\work\\example.git")).toBe("example");
    expect(deriveRepoNameFromRepoUrl("d:/repos/example/")).toBe("example");
  });
});
