import { describe, expect, it, vi } from "vitest";

import {
  AnalysisError,
  analyzeConversation,
  normalizeAnalysisRequest,
  parseAnalysisResult,
} from "./analysis.js";

const conversationId = "550e8400-e29b-41d4-a716-446655440000";
const transcript = [
  {
    id: "u-1",
    sequence: 1,
    role: "user",
    text: " 下周开始内测。 ",
    status: "completed",
    startedAt: 1,
  },
  {
    id: "a-1",
    sequence: 2,
    role: "assistant",
    text: "需要先确认数据权限。",
    status: "interrupted",
    startedAt: 2,
  },
];

function modelResponse(content, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => ({ choices: [{ message: { content } }] }),
  };
}

describe("analysis request validation", () => {
  it("normalizes a valid transcript", () => {
    expect(normalizeAnalysisRequest({ conversationId, transcript })).toMatchObject({
      conversationId,
      transcript: [{ text: "下周开始内测。" }, { status: "interrupted" }],
    });
  });

  it("rejects short ids, system roles, and empty transcripts", () => {
    expect(() => normalizeAnalysisRequest({ conversationId: "7F2A", transcript }))
      .toThrow(AnalysisError);
    expect(() => normalizeAnalysisRequest({
      conversationId,
      transcript: [{ ...transcript[0], role: "system" }],
    })).toThrow(/角色无效/);
    expect(() => normalizeAnalysisRequest({
      conversationId,
      transcript: [transcript[0], { ...transcript[1], sequence: 1 }],
    })).toThrow(/序号重复/);
    expect(() => normalizeAnalysisRequest({ conversationId, transcript: [] }))
      .toThrow(/暂无可分析内容/);
  });
});

describe("analysis response validation", () => {
  it("keeps only concerns with valid evidence", () => {
    expect(parseAnalysisResult(JSON.stringify({
      summary: "讨论了内测准备。",
      concerns: [
        { text: "权限范围尚未明确。", evidenceSequences: [2] },
        { text: "无依据。", evidenceSequences: [99] },
      ],
    }), transcript)).toEqual({
      summary: "讨论了内测准备。",
      concerns: [{
        id: "concern-1",
        text: "权限范围尚未明确。",
        evidenceSequences: [2],
      }],
    });
  });
});

describe("Qwen analysis client", () => {
  it("returns a sanitized structured result", async () => {
    const fetchImpl = vi.fn(async () => modelResponse(JSON.stringify({
      summary: "讨论了内测准备。",
      concerns: [{ text: "权限范围尚未明确。", evidenceSequences: [2] }],
    })));

    const result = await analyzeConversation(
      { conversationId, transcript },
      { apiKey: "secret", fetchImpl, now: () => new Date("2026-07-15T12:00:00Z") },
    );

    expect(result).toMatchObject({
      conversationId,
      summary: "讨论了内测准备。",
      generatedAt: "2026-07-15T12:00:00.000Z",
    });
    const request = JSON.parse(fetchImpl.mock.calls[0][1].body);
    expect(request).toMatchObject({
      model: "qwen3.7-max",
      enable_thinking: true,
      stream: false,
    });
    expect(fetchImpl.mock.calls[0][1].headers.Authorization).toBe("Bearer secret");
  });

  it("retries one invalid model result", async () => {
    const fetchImpl = vi.fn()
      .mockResolvedValueOnce(modelResponse("not-json"))
      .mockResolvedValueOnce(modelResponse(JSON.stringify({ summary: "有效摘要", concerns: [] })));

    await expect(analyzeConversation(
      { conversationId, transcript },
      { apiKey: "secret", fetchImpl },
    )).resolves.toMatchObject({ summary: "有效摘要" });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it("retries a response with a missing structured field", async () => {
    const fetchImpl = vi.fn()
      .mockResolvedValueOnce(modelResponse(JSON.stringify({ summary: "缺少关注点字段" })))
      .mockResolvedValueOnce(modelResponse(JSON.stringify({ summary: "完整摘要", concerns: [] })));

    await expect(analyzeConversation(
      { conversationId, transcript },
      { apiKey: "secret", fetchImpl },
    )).resolves.toMatchObject({ summary: "完整摘要", concerns: [] });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it("does not retry authentication and rate-limit failures", async () => {
    const authFetch = vi.fn(async () => modelResponse({}, 401));
    const rateFetch = vi.fn(async () => modelResponse({}, 429));

    await expect(analyzeConversation(
      { conversationId, transcript },
      { apiKey: "secret", fetchImpl: authFetch },
    )).rejects.toMatchObject({ code: "ANALYSIS_AUTH_FAILED", retryable: false });
    await expect(analyzeConversation(
      { conversationId, transcript },
      { apiKey: "secret", fetchImpl: rateFetch },
    )).rejects.toMatchObject({ code: "ANALYSIS_RATE_LIMITED", retryable: true });
    expect(authFetch).toHaveBeenCalledTimes(1);
    expect(rateFetch).toHaveBeenCalledTimes(1);
  });
});
