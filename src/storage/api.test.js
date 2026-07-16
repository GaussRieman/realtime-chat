import { describe, expect, it, vi } from "vitest";

import {
  ConversationApiError,
  createConversationPayload,
  saveConversation,
  updateConversationAnalysis,
} from "./api.js";

const snapshot = {
  conversationId: "550e8400-e29b-41d4-a716-446655440000",
  startedAt: 1,
  endedAt: 2,
  durationSeconds: 1,
  voice: "longanqian",
  transcriptionFailureCount: 2,
  transcript: [{
    id: "system-1",
    role: "system",
    text: "已连接",
    status: "completed",
    startedAt: 1,
    completedAt: 1,
    ignored: true,
  }],
};

function jsonResponse(payload, { ok = true, status = 200 } = {}) {
  return { ok, status, json: async () => payload };
}

describe("conversation storage API", () => {
  it("creates a bounded save payload from the immutable snapshot", () => {
    expect(createConversationPayload(snapshot)).toEqual({
      conversationId: snapshot.conversationId,
      startedAt: 1,
      endedAt: 2,
      durationSeconds: 1,
      voice: "longanqian",
      transcriptionFailureCount: 2,
      transcript: [{
        id: "system-1",
        role: "system",
        text: "已连接",
        status: "completed",
        startedAt: 1,
        completedAt: 1,
      }],
    });
  });

  it("sends snapshots and versioned analysis updates", async () => {
    const fetchImpl = vi.fn(async (_url, options) => jsonResponse(
      options.method === "PATCH" ? { analysisVersion: 2 } : { saved: true },
    ));
    await saveConversation(snapshot, { fetchImpl });
    await updateConversationAnalysis(snapshot.conversationId, {
      summary: "摘要",
      concerns: [],
      generatedAt: "2026-07-16T00:00:00.000Z",
      summaryEdited: false,
      concernsEdited: false,
    }, 1, { fetchImpl });

    expect(JSON.parse(fetchImpl.mock.calls[1][1].body).expectedVersion).toBe(1);
  });

  it("maps stable API errors", async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({
      error: { code: "STORAGE_UNAVAILABLE", message: "不可用", retryable: true },
    }, { ok: false, status: 503 }));
    await expect(saveConversation(snapshot, { fetchImpl })).rejects.toEqual(
      expect.objectContaining({
        name: "ConversationApiError",
        code: "STORAGE_UNAVAILABLE",
        status: 503,
      }),
    );
    expect(ConversationApiError).toBeTypeOf("function");
  });
});
