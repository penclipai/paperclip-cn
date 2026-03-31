import { describe, expect, it } from "vitest";
import { generateReadme } from "../services/company-export-readme";

describe("company export readme", () => {
  it("uses an external CLI entrypoint in getting started instructions", () => {
    const readme = generateReadme(
      {
        version: "1",
        company: {
          slug: "paperclip-cn",
          name: "Paperclip CN",
          issuePrefix: "PAP",
          description: null,
          purpose: null,
        },
        agents: [],
        projects: [],
        goals: [],
        issues: [],
        comments: [],
        documents: [],
        skills: [],
        knowledgeAssets: [],
        plugins: [],
        routines: [],
        workspaces: [],
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
