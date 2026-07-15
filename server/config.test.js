import { describe, expect, it } from "vitest";

import {
  ALLOWED_VOICES,
  ANALYSIS_MODEL,
  ANALYSIS_URL,
  loadConfig,
  resolveVoice,
} from "./config.js";

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

describe("analysis configuration", () => {
  it("uses the documented Qwen 3.7 Max compatible endpoint", () => {
    expect(ANALYSIS_MODEL).toBe("qwen3.7-max");
    expect(ANALYSIS_URL).toContain("/compatible-mode/v1/chat/completions");
  });

  it("trims the shared DashScope API key", () => {
    expect(loadConfig({ DASHSCOPE_API_KEY: "  sk-test  " }).apiKey).toBe("sk-test");
  });
});
