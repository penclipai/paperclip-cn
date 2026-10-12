import { chmodSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it } from "vitest";
import { removeNativeHarnessBackup } from "./native-harness-backup-cleanup.js";

it("removes retired backups containing immutable skills without modifying live files or symlink targets", () => {
  const base = mkdtempSync(join(tmpdir(), "paperclip-backup-cleanup-"));
  const retired = join(base, "previous");
  const nested = join(retired, "claude", "skills", "first-task");
  const live = join(base, "current");
  mkdirSync(nested, { recursive: true });
  mkdirSync(live);
  writeFileSync(join(nested, "SKILL.md"), "retired instructions", { mode: 0o444 });
  writeFileSync(join(live, "SKILL.md"), "live instructions", { mode: 0o444 });
  symlinkSync(live, join(retired, "outside"));
  chmodSync(nested, 0o555);
  chmodSync(join(retired, "claude", "skills"), 0o555);
  chmodSync(retired, 0o555);
  chmodSync(live, 0o555);
  const liveDirectoryMode = lstatSync(live).mode & 0o777;
  const liveFileMode = lstatSync(join(live, "SKILL.md")).mode & 0o777;
  try {
    removeNativeHarnessBackup(retired);
    expect(existsSync(retired)).toBe(false);
    expect(readFileSync(join(live, "SKILL.md"), "utf8")).toBe("live instructions");
    // Windows only exposes a reduced readonly mode through stat; assert that
    // cleanup left the live target untouched instead of assuming POSIX bits.
    expect(lstatSync(live).mode & 0o777).toBe(liveDirectoryMode);
    expect(lstatSync(join(live, "SKILL.md")).mode & 0o777).toBe(liveFileMode);
    expect(() => removeNativeHarnessBackup(retired)).not.toThrow();
  } finally {
    for (const directory of [retired, join(retired, "claude", "skills"), nested, live]) {
      if (existsSync(directory)) chmodSync(directory, 0o700);
    }
    rmSync(base, { recursive: true, force: true });
  }
});
