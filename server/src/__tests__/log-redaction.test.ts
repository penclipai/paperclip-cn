import { describe, expect, it } from "vitest";
import {
  maskUserNameForLogs,
  redactCurrentUserText,
  redactCurrentUserValue,
} from "../log-redaction.js";

describe("log redaction", () => {
  it("redacts the active username inside home-directory paths", () => {
    const userName = "paperclipuser";
    const maskedUserName = maskUserNameForLogs(userName);
    const input = [
      `cwd=/Users/${userName}/paperclip`,
      `home=/home/${userName}/workspace`,
      `win=C:\\Users\\${userName}\\paperclip`,
    ].join("\n");

    const result = redactCurrentUserText(input, {
      userNames: [userName],
      homeDirs: [`/Users/${userName}`, `/home/${userName}`, `C:\\Users\\${userName}`],
    });

    expect(result).toContain(`cwd=/Users/${maskedUserName}/paperclip`);
    expect(result).toContain(`home=/home/${maskedUserName}/workspace`);
    expect(result).toContain(`win=C:\\Users\\${maskedUserName}\\paperclip`);
    expect(result).not.toContain(userName);
  });

  it("redacts standalone username mentions without mangling larger tokens", () => {
    const userName = "paperclipuser";
    const maskedUserName = maskUserNameForLogs(userName);
    const result = redactCurrentUserText(
      `user ${userName} said ${userName}/project should stay but apaperclipuserz should not change`,
      {
        userNames: [userName],
        homeDirs: [],
      },
    );

    expect(result).toBe(
      `user ${maskedUserName} said ${maskedUserName}/project should stay but apaperclipuserz should not change`,
    );
  });

  it("fully redacts one-code-point Windows home-directory names", () => {
    const cases = ["h", "陈", "😀"];

    for (const userName of cases) {
      const homeDir = `D:\\Users\\${userName}`;
      const input = `${homeDir}\\workspace\\report.log`;
      const result = redactCurrentUserText(input, {
        userNames: [userName],
        homeDirs: [homeDir],
      });

      expect(maskUserNameForLogs(userName)).toBe("*");
      expect(result).toBe("D:\\Users\\*\\workspace\\report.log");
      expect(result).not.toContain(homeDir);
    }

    expect(maskUserNameForLogs("h", "[hidden]")).toBe("[hidden]");
    expect(maskUserNameForLogs("", "[hidden]")).toBe("[hidden]");
    expect(maskUserNameForLogs("li")).toBe("l*");
    expect(maskUserNameForLogs("陈杰")).toBe("陈*");
  });

  it("refreshes default home directories after HOME and USERPROFILE change", () => {
    const previousHome = process.env.HOME;
    const previousUserProfile = process.env.USERPROFILE;
    const prewarmedHome = "D:\\CodexQaTemp\\prewarmed-redaction-home";
    const changedHome = "D:\\CodexQaTemp\\changed-redaction-home";

    try {
      process.env.HOME = prewarmedHome;
      process.env.USERPROFILE = prewarmedHome;
      redactCurrentUserText(`prewarm ${prewarmedHome}\\first.log`);

      process.env.HOME = changedHome;
      process.env.USERPROFILE = changedHome;
      const result = redactCurrentUserText(`read failed at ${changedHome}\\second.log`);

      expect(result).toContain("second.log");
      expect(result).not.toContain(changedHome);
    } finally {
      if (previousHome === undefined) delete process.env.HOME;
      else process.env.HOME = previousHome;
      if (previousUserProfile === undefined) delete process.env.USERPROFILE;
      else process.env.USERPROFILE = previousUserProfile;
    }
  });

  it("recursively redacts nested event payloads", () => {
    const userName = "paperclipuser";
    const maskedUserName = maskUserNameForLogs(userName);
    const result = redactCurrentUserValue({
      cwd: `/Users/${userName}/paperclip`,
      prompt: `open /Users/${userName}/paperclip/ui`,
      nested: {
        author: userName,
      },
      values: [userName, `/home/${userName}/project`],
    }, {
      userNames: [userName],
      homeDirs: [`/Users/${userName}`, `/home/${userName}`],
    });

    expect(result).toEqual({
      cwd: `/Users/${maskedUserName}/paperclip`,
      prompt: `open /Users/${maskedUserName}/paperclip/ui`,
      nested: {
        author: maskedUserName,
      },
      values: [maskedUserName, `/home/${maskedUserName}/project`],
    });
  });

  it("skips redaction when disabled", () => {
    const input = "cwd=/Users/paperclipuser/paperclip";
    expect(redactCurrentUserText(input, { enabled: false })).toBe(input);
  });
});
