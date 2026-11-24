import { describe, expect, it } from "vitest";
import { generateReadme } from "../services/company-export-readme.js";

describe("company export readme", () => {
  it("uses an external CLI entrypoint in getting started instructions", () => {
    const readme = generateReadme(
      {
        schemaVersion: 1,
        generatedAt: "2026-11-10T00:00:00.000Z",
        source: null,
        includes: { company: true, agents: true, projects: true, issues: true, skills: true },
        sidebar: null,
        company: {
          path: "COMPANY.md",
          name: "Paperclip CN",
          description: null,
          logoPath: null,
          requireBoardApprovalForNewAgents: true,
          feedbackDataSharingEnabled: false,
          feedbackDataSharingConsentAt: null,
          feedbackDataSharingConsentByUserId: null,
          feedbackDataSharingTermsVersion: null,
        },
        agents: [],
        projects: [],
        issues: [],
        skills: [],
        envInputs: [],
      },
      {
        companyName: "Paperclip CN",
        companyDescription: null,
      },
    );

    expect(readme).toContain("npx penclip company import this-github-url-or-folder");
    expect(readme).not.toContain("pnpm penclip company import this-github-url-or-folder");
  });
});
