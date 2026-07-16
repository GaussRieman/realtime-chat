import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  ConversationStorageError,
  ConversationStore,
  normalizeConversationSnapshot,
} from "./conversationStore.js";

const conversationId = "550e8400-e29b-41d4-a716-446655440000";

function conversationIdFor(index) {
  return `550e8400-e29b-41d4-a716-${String(index).padStart(12, "0")}`;
}

function snapshot(overrides = {}) {
  return {
    conversationId,
    startedAt: 1_000,
    endedAt: 8_000,
    durationSeconds: 7,
    voice: "longanqian",
    transcriptionFailureCount: 0,
    transcript: [
      {
        id: "system-1",
        role: "system",
        text: "已连接",
        status: "completed",
        startedAt: 1_000,
        completedAt: 1_000,
      },
      {
        id: "user-1",
        role: "user",
        text: "你好",
        status: "completed",
        startedAt: 2_000,
        completedAt: 2_500,
      },
      {
        id: "assistant-1",
        role: "assistant",
        text: "你好呀",
        status: "interrupted",
        startedAt: 3_000,
        completedAt: 3_500,
      },
    ],
    ...overrides,
  };
}

describe("conversation normalization", () => {
  it("assigns separate display and analysis sequences", () => {
    const normalized = normalizeConversationSnapshot(snapshot());
    expect(normalized.transcript.map((item) => ({
      sequence: item.sequence,
      analysisSequence: item.analysisSequence,
    }))).toEqual([
      { sequence: 1, analysisSequence: null },
      { sequence: 2, analysisSequence: 1 },
      { sequence: 3, analysisSequence: 2 },
    ]);
    expect(normalized.transcriptionStatus).toBe("complete");
  });

  it("distinguishes partial and unavailable user transcription", () => {
    expect(normalizeConversationSnapshot(snapshot({ transcriptionFailureCount: 1 }))
      .transcriptionStatus).toBe("partial");
    expect(normalizeConversationSnapshot(snapshot({
      transcriptionFailureCount: 2,
      transcript: snapshot().transcript.filter((item) => item.role !== "user"),
    })).transcriptionStatus).toBe("unavailable");
  });

  it("drops empty captions and keeps both sequence namespaces contiguous", () => {
    const normalized = normalizeConversationSnapshot(snapshot({
      transcript: [
        snapshot().transcript[0],
        { ...snapshot().transcript[1], id: "empty", text: "   " },
        snapshot().transcript[2],
      ],
    }));
    expect(normalized.transcript).toHaveLength(2);
    expect(normalized.transcript.map((item) => [item.sequence, item.analysisSequence]))
      .toEqual([[1, null], [2, 1]]);
  });
});

describe("conversation store", () => {
  let directory;
  let store;

  beforeEach(() => {
    directory = fs.mkdtempSync(path.join(os.tmpdir(), "audio-anything-store-"));
    store = new ConversationStore(path.join(directory, "history.sqlite"));
  });

  afterEach(() => {
    store?.close();
    fs.rmSync(directory, { recursive: true, force: true });
  });

  it("creates the database and persists an idempotent snapshot", () => {
    expect(store.saveConversation(snapshot())).toMatchObject({
      conversationId,
      transcriptionStatus: "complete",
    });
    expect(store.saveConversation(snapshot({ durationSeconds: 8 }))).toMatchObject({
      saved: true,
    });

    const detail = store.getConversation(conversationId);
    expect(detail.durationSeconds).toBe(8);
    expect(detail.transcript).toHaveLength(3);
    expect(detail.transcript[1]).toMatchObject({ sequence: 2, analysisSequence: 1 });
    expect(store.listConversations()).toHaveLength(1);
  });

  it("reopens an existing database without losing records", () => {
    store.saveConversation(snapshot());
    const databasePath = store.databasePath;
    store.close();
    store = new ConversationStore(databasePath);

    expect(store.getConversation(conversationId)).toMatchObject({
      conversationId,
      transcript: expect.arrayContaining([
        expect.objectContaining({ id: "user-1", text: "你好" }),
      ]),
    });
    expect(store.database.prepare("PRAGMA user_version").get().user_version).toBe(1);
  });

  it("persists analysis and rejects stale versions or changed evidence", () => {
    store.saveConversation(snapshot());
    expect(store.updateAnalysis(conversationId, {
      summary: "摘要",
      concerns: [{ id: "concern-1", text: "需确认", evidenceSequences: [1] }],
      generatedAt: "2026-07-16T07:30:00.000Z",
      expectedVersion: 0,
      summaryEdited: false,
      concernsEdited: false,
    }).analysisVersion).toBe(1);

    expect(() => store.updateAnalysis(conversationId, {
      summary: "旧摘要",
      concerns: [{ id: "concern-1", text: "旧内容", evidenceSequences: [1] }],
      generatedAt: "2026-07-16T07:30:00.000Z",
      expectedVersion: 0,
      summaryEdited: true,
      concernsEdited: false,
    })).toThrowError(expect.objectContaining({ code: "ANALYSIS_VERSION_CONFLICT" }));

    expect(() => store.updateAnalysis(conversationId, {
      summary: "新摘要",
      concerns: [{ id: "concern-1", text: "新内容", evidenceSequences: [2] }],
      generatedAt: "2026-07-16T07:30:00.000Z",
      expectedVersion: 1,
      summaryEdited: true,
      concernsEdited: true,
    })).toThrowError(expect.objectContaining({ code: "CONVERSATION_INVALID" }));

    expect(store.getConversation(conversationId).analysis).toMatchObject({
      summary: "摘要",
      concerns: [{ id: "concern-1", evidenceSequences: [1] }],
    });
  });

  it("preserves analysis when the base snapshot is retried", () => {
    store.saveConversation(snapshot());
    store.updateAnalysis(conversationId, {
      summary: "摘要",
      concerns: [],
      generatedAt: "2026-07-16T07:30:00.000Z",
      expectedVersion: 0,
      summaryEdited: false,
      concernsEdited: false,
    });
    store.saveConversation(snapshot({ durationSeconds: 9 }));

    const detail = store.getConversation(conversationId);
    expect(detail.durationSeconds).toBe(9);
    expect(detail.analysisVersion).toBe(1);
    expect(detail.analysis.summary).toBe("摘要");
  });

  it("preserves the original generation time and accumulated edit flags", () => {
    store.saveConversation(snapshot());
    store.updateAnalysis(conversationId, {
      summary: "摘要",
      concerns: [{ id: "concern-1", text: "需确认", evidenceSequences: [1] }],
      generatedAt: "2026-07-16T07:30:00.000Z",
      expectedVersion: 0,
      summaryEdited: true,
      concernsEdited: false,
    });
    store.updateAnalysis(conversationId, {
      summary: "更新摘要",
      concerns: [{ id: "concern-1", text: "已确认", evidenceSequences: [1] }],
      generatedAt: "2026-07-16T08:30:00.000Z",
      expectedVersion: 1,
      summaryEdited: false,
      concernsEdited: true,
    });

    expect(store.getConversation(conversationId).analysis).toMatchObject({
      generatedAt: "2026-07-16T07:30:00.000Z",
      summaryEdited: true,
      concernsEdited: true,
    });
  });

  it("rolls back the entire replacement when a transcript ID conflicts", () => {
    store.saveConversation(snapshot());
    const invalidReplacement = snapshot({
      durationSeconds: 99,
      transcript: [
        snapshot().transcript[0],
        { ...snapshot().transcript[1], id: "system-1" },
      ],
    });

    expect(() => store.saveConversation(invalidReplacement)).toThrowError(
      expect.objectContaining({ code: "CONVERSATION_SAVE_FAILED" }),
    );
    expect(store.getConversation(conversationId).durationSeconds).toBe(7);
    expect(store.getConversation(conversationId).transcript).toHaveLength(3);
  });

  it("returns a stable not-found error", () => {
    expect(() => store.getConversation(crypto.randomUUID())).toThrowError(
      expect.objectContaining({ code: "CONVERSATION_NOT_FOUND" }),
    );
    expect(ConversationStorageError).toBeTypeOf("function");
  });

  it("returns only the most recent 50 conversations in descending order", () => {
    for (let index = 1; index <= 55; index += 1) {
      store.saveConversation(snapshot({
        conversationId: conversationIdFor(index),
        startedAt: index * 1_000,
        endedAt: index * 1_000 + 500,
      }));
    }

    const conversations = store.listConversations();
    expect(conversations).toHaveLength(50);
    expect(conversations[0].conversationId).toBe(conversationIdFor(55));
    expect(conversations.at(-1).conversationId).toBe(conversationIdFor(6));
  });
});
