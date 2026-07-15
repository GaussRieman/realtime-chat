import { describe, expect, it } from "vitest";

import { ALLOWED_VOICES, resolveVoice } from "./config.js";

describe("voice configuration", () => {
  it("allows every documented system voice", () => {
    expect(Array.from(ALLOWED_VOICES)).toEqual([
      "longanqian",
      "longanlingxin",
      "longanlingxi",
      "longanxiaoxin",
      "longanlufeng",
    ]);
  });

  it("falls back to the default for unknown voices", () => {
    expect(resolveVoice("not-a-voice")).toBe("longanqian");
    expect(resolveVoice("longanlingxi")).toBe("longanlingxi");
  });
});
