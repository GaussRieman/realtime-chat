import { describe, expect, it } from "vitest";

import { analysisReducer, INITIAL_ANALYSIS_STATE } from "./analysisState.js";
import { buildAnalysisMarkdown } from "./markdown.js";
import { createAnalysisPayload } from "./normalize.js";

const conversationId = "550e8400-e29b-41d4-a716-446655440000";
const snapshot = {
  conversationId,
  durationSeconds: 82,
  endedAt: new Date("2026-07-15T12:00:00Z").getTime(),
  transcript: [
    { id: "sys", role: "system", text: "已连接", status: "completed", startedAt: 1 },
    { id: "u", role: "user", text: " 问题 ", status: "completed", startedAt: 2 },
    { id: "a", role: "assistant", text: "回答", status: "interrupted", startedAt: 3 },
  ],
};

describe("analysis payload", () => {
  it("filters system rows and assigns stable contiguous sequences", () => {
    expect(createAnalysisPayload(snapshot)).toEqual({
      conversationId,
      transcript: [
        { id: "u", sequence: 1, role: "user", text: "问题", status: "completed", startedAt: 2 },
        { id: "a", sequence: 2, role: "assistant", text: "回答", status: "interrupted", startedAt: 3 },
      ],
    });
  });
});

describe("analysis reducer", () => {
  it("ignores stale and mismatched responses", () => {
    const generating = analysisReducer(INITIAL_ANALYSIS_STATE, {
      type: "start",
      snapshot,
      requestId: 2,
    });
    const stale = analysisReducer(generating, {
      type: "success",
      requestId: 1,
      result: { conversationId, summary: "旧摘要", concerns: [] },
    });
    const mismatched = analysisReducer(generating, {
      type: "success",
      requestId: 2,
      result: { conversationId: crypto.randomUUID(), summary: "错会话", concerns: [] },
    });
    expect(stale).toBe(generating);
    expect(mismatched).toBe(generating);
  });

  it("edits text without changing concern identity or evidence", () => {
    const ready = analysisReducer({
      status: "generating",
      snapshot,
      result: null,
      error: null,
      requestId: 1,
    }, {
      type: "success",
      requestId: 1,
      result: {
        conversationId,
        summary: "摘要",
        concerns: [{ id: "concern-1", text: "旧关注点", evidenceSequences: [1] }],
      },
    });
    const edited = analysisReducer(ready, {
      type: "save-concerns",
      concerns: ["新关注点"],
    });
    expect(edited.result.concerns[0]).toEqual({
      id: "concern-1",
      text: "新关注点",
      evidenceSequences: [1],
    });
    expect(edited.result.concernsEdited).toBe(true);
  });
});

describe("analysis Markdown", () => {
  it("exports summary, concerns, and the immutable original", () => {
    const markdown = buildAnalysisMarkdown({
      snapshot,
      result: {
        summary: "摘要内容",
        summaryEdited: true,
        concerns: [{ text: "关注内容" }],
        concernsEdited: false,
      },
    });
    expect(markdown).toContain("## 摘要（已编辑）");
    expect(markdown).toContain("1. 关注内容");
    expect(markdown).toContain("你: 问题");
    expect(markdown).toContain("千问（被打断）: 回答");
  });
});
