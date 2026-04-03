import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  listQwenSkills,
  syncQwenSkills,
} from "@penclipai/adapter-qwen-local/server";

async function makeTempDir(prefix: string): Promise<string> {
  return fs.mkdtemp(path.join(os.tmpdir(), prefix));
}

async function createSkillDir(root: string, name: string) {
  const skillDir = path.join(root, name);
  await fs.mkdir(skillDir, { recursive: true });
  await fs.writeFile(path.join(skillDir, "SKILL.md"), `---\nname: ${name}\n---\n`, "utf8");
  return skillDir;
}

describe("qwen local skill sync", () => {
  const paperclipKey = "penclipai/paperclip-cn/paperclip";
  const cleanupDirs = new Set<string>();

  afterEach(async () => {
    await Promise.all(Array.from(cleanupDirs).map((dir) => fs.rm(dir, { recursive: true, force: true })));
    cleanupDirs.clear();
  });

  it("reports configured Paperclip skills and installs them into the Qwen skills home", async () => {
    const home = await makeTempDir("paperclip-qwen-skill-sync-");
    cleanupDirs.add(home);

    const ctx = {
      agentId: "agent-1",
      companyId: "company-1",
      adapterType: "qwen_local",
      config: {
        env: {
          HOME: home,
        },
        paperclipSkillSync: {
          desiredSkills: [paperclipKey],
        },
      },
    } as const;

    const before = await listQwenSkills(ctx);
    expect(before.mode).toBe("persistent");
    expect(before.desiredSkills).toContain(paperclipKey);
    expect(before.entries.find((entry) => entry.key === paperclipKey)?.required).toBe(true);
    expect(before.entries.find((entry) => entry.key === paperclipKey)?.state).toBe("missing");

    const after = await syncQwenSkills(ctx, [paperclipKey]);
    expect(after.entries.find((entry) => entry.key === paperclipKey)?.state).toBe("installed");
    await expect(fs.realpath(path.join(home, ".qwen", "skills", "paperclip"))).resolves.toMatch(/paperclip$/);
  });

  it("recognizes runtime skills supplied outside the bundled Paperclip directory", async () => {
    const home = await makeTempDir("paperclip-qwen-runtime-skills-home-");
    const runtimeSkills = await makeTempDir("paperclip-qwen-runtime-skills-src-");
    cleanupDirs.add(home);
    cleanupDirs.add(runtimeSkills);

    const paperclipDir = await createSkillDir(runtimeSkills, "paperclip");
    const asciiHeartDir = await createSkillDir(runtimeSkills, "ascii-heart");

    const ctx = {
      agentId: "agent-3",
      companyId: "company-1",
      adapterType: "qwen_local",
      config: {
        env: {
          HOME: home,
        },
        paperclipRuntimeSkills: [
          {
            key: "paperclip",
            runtimeName: "paperclip",
            source: paperclipDir,
            required: true,
            requiredReason: "Bundled Paperclip skills are always available for local adapters.",
          },
          {
            key: "ascii-heart",
            runtimeName: "ascii-heart",
            source: asciiHeartDir,
          },
        ],
        paperclipSkillSync: {
          desiredSkills: ["ascii-heart"],
        },
      },
    } as const;

    const before = await listQwenSkills(ctx);
    expect(before.warnings).toEqual([]);
    expect(before.desiredSkills).toEqual(["paperclip", "ascii-heart"]);
    expect(before.entries.find((entry) => entry.key === "ascii-heart")?.state).toBe("missing");

    const after = await syncQwenSkills(ctx, ["ascii-heart"]);
    expect(after.warnings).toEqual([]);
    expect(after.entries.find((entry) => entry.key === "ascii-heart")?.state).toBe("installed");
    expect(await fs.realpath(path.join(home, ".qwen", "skills", "ascii-heart"))).toBe(
      await fs.realpath(asciiHeartDir),
    );
  });

  it("keeps required bundled Paperclip skills installed even when the desired set is emptied", async () => {
    const home = await makeTempDir("paperclip-qwen-skill-prune-");
    cleanupDirs.add(home);

    const configuredCtx = {
      agentId: "agent-2",
      companyId: "company-1",
      adapterType: "qwen_local",
      config: {
        env: {
          HOME: home,
        },
        paperclipSkillSync: {
          desiredSkills: [paperclipKey],
        },
      },
    } as const;

    await syncQwenSkills(configuredCtx, [paperclipKey]);

    const clearedCtx = {
      ...configuredCtx,
      config: {
        env: {
          HOME: home,
        },
        paperclipSkillSync: {
          desiredSkills: [],
        },
      },
    } as const;

    const after = await syncQwenSkills(clearedCtx, []);
    expect(after.desiredSkills).toContain(paperclipKey);
    expect(after.entries.find((entry) => entry.key === paperclipKey)?.state).toBe("installed");
    await expect(fs.realpath(path.join(home, ".qwen", "skills", "paperclip"))).resolves.toMatch(/paperclip$/);
  });
});
