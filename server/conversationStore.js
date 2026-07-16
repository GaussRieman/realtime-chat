import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";

import { ALLOWED_VOICES } from "./config.js";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const ROLES = new Set(["user", "assistant", "system"]);
const STATUSES = new Set(["completed", "interrupted", "error"]);
const ANALYZABLE_ROLES = new Set(["user", "assistant"]);
const ANALYZABLE_STATUSES = new Set(["completed", "interrupted"]);

export const CONVERSATION_LIMITS = Object.freeze({
  transcriptItems: 2_000,
  transcriptChars: 16_000,
  summaryChars: 20_000,
  concernChars: 4_000,
  concerns: 5,
});

export class ConversationStorageError extends Error {
  constructor(code, message, { status = 500, retryable = true, cause } = {}) {
    super(message, { cause });
    this.name = "ConversationStorageError";
    this.code = code;
    this.status = status;
    this.retryable = retryable;
  }
}

function invalid(message) {
  return new ConversationStorageError("CONVERSATION_INVALID", message, {
    status: 400,
    retryable: false,
  });
}

function characterLength(value) {
  return Array.from(value).length;
}

function requiredText(value, label, maxChars) {
  if (typeof value !== "string") throw invalid(`${label}必须是字符串。`);
  const text = value.trim();
  if (!text) throw invalid(`${label}不能为空。`);
  if (characterLength(text) > maxChars) throw invalid(`${label}过长。`);
  return text;
}

function timestamp(value, label) {
  if (!Number.isSafeInteger(value) || value < 0) throw invalid(`${label}无效。`);
  return value;
}

function normalizeTranscript(items) {
  if (!Array.isArray(items)) throw invalid("transcript 必须是数组。");
  if (items.length > CONVERSATION_LIMITS.transcriptItems) {
    throw new ConversationStorageError("CONVERSATION_TOO_LARGE", "本次会话字幕条目过多。", {
      status: 413,
      retryable: false,
    });
  }

  let sequence = 0;
  let analysisSequence = 0;
  return items.flatMap((item) => {
    if (!item || typeof item !== "object") throw invalid("字幕条目无效。");
    const role = typeof item.role === "string" ? item.role : "";
    const status = typeof item.status === "string" ? item.status : "";
    if (!ROLES.has(role)) throw invalid("字幕角色无效。");
    if (!STATUSES.has(status)) throw invalid("字幕状态无效。");

    if (typeof item.text !== "string") throw invalid("字幕文本必须是字符串。");
    const text = item.text.trim();
    if (characterLength(text) > CONVERSATION_LIMITS.transcriptChars) {
      throw invalid("字幕文本过长。");
    }
    if (!text) return [];

    const itemId = requiredText(item.id, "字幕 ID", 256);
    const startedAt = timestamp(item.startedAt, "字幕开始时间");
    const completedAt = item.completedAt == null
      ? null
      : timestamp(item.completedAt, "字幕完成时间");
    const analyzable = ANALYZABLE_ROLES.has(role) && ANALYZABLE_STATUSES.has(status);
    sequence += 1;
    if (analyzable) analysisSequence += 1;

    return [{
      sequence,
      analysisSequence: analyzable ? analysisSequence : null,
      itemId,
      role,
      text,
      status,
      startedAt,
      completedAt,
    }];
  });
}

export function normalizeConversationSnapshot(payload) {
  if (!payload || typeof payload !== "object") throw invalid("会话请求无效。");
  const conversationId = typeof payload.conversationId === "string"
    ? payload.conversationId.trim()
    : "";
  if (!UUID_PATTERN.test(conversationId)) throw invalid("conversationId 必须是完整 UUID。");

  const startedAt = timestamp(payload.startedAt, "会话开始时间");
  const endedAt = timestamp(payload.endedAt, "会话结束时间");
  if (endedAt < startedAt) throw invalid("会话结束时间不能早于开始时间。");
  if (!Number.isSafeInteger(payload.durationSeconds) || payload.durationSeconds < 0) {
    throw invalid("会话时长无效。");
  }
  if (!ALLOWED_VOICES.has(payload.voice)) throw invalid("会话音色无效。");
  if (!Number.isSafeInteger(payload.transcriptionFailureCount) || payload.transcriptionFailureCount < 0) {
    throw invalid("转写失败次数无效。");
  }

  const transcript = normalizeTranscript(payload.transcript);
  const userItems = transcript.filter((item) => item.role === "user").length;
  const transcriptionStatus = payload.transcriptionFailureCount === 0
    ? "complete"
    : userItems > 0
      ? "partial"
      : "unavailable";

  return {
    conversationId,
    startedAt,
    endedAt,
    durationSeconds: payload.durationSeconds,
    voice: payload.voice,
    transcriptionFailureCount: payload.transcriptionFailureCount,
    transcriptionStatus,
    transcript,
  };
}

function normalizeConcerns(concerns, validSequences) {
  if (!Array.isArray(concerns)) throw invalid("关注点必须是数组。");
  if (concerns.length > CONVERSATION_LIMITS.concerns) throw invalid("关注点数量过多。");

  return concerns.map((concern) => {
    if (!concern || typeof concern !== "object") throw invalid("关注点无效。");
    const id = requiredText(concern.id, "关注点 ID", 128);
    const text = requiredText(concern.text, "关注点文本", CONVERSATION_LIMITS.concernChars);
    if (!Array.isArray(concern.evidenceSequences) || concern.evidenceSequences.length === 0) {
      throw invalid("关注点必须包含原文证据。");
    }
    const evidenceSequences = [...new Set(concern.evidenceSequences)];
    if (evidenceSequences.some((value) => (
      !Number.isSafeInteger(value) || value <= 0 || !validSequences.has(value)
    ))) {
      throw invalid("关注点证据序号无效。");
    }
    return { id, text, evidenceSequences };
  });
}

function sameConcernStructure(previous, next) {
  if (previous.length !== next.length) return false;
  return previous.every((concern, index) => (
    concern.id === next[index].id
    && concern.evidenceSequences.length === next[index].evidenceSequences.length
    && concern.evidenceSequences.every((value, itemIndex) => (
      value === next[index].evidenceSequences[itemIndex]
    ))
  ));
}

function parseConcerns(raw) {
  if (typeof raw !== "string") return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function mapConversationRow(row) {
  if (!row) return null;
  const concerns = parseConcerns(row.concerns_json);
  const hasAnalysis = typeof row.summary === "string" && row.summary.length > 0;
  return {
    conversationId: row.id,
    startedAt: row.started_at,
    endedAt: row.ended_at,
    durationSeconds: row.duration_seconds,
    voice: row.voice,
    transcriptionStatus: row.transcription_status,
    transcriptionFailureCount: row.transcription_failure_count,
    analysisVersion: row.analysis_version,
    analysis: hasAnalysis ? {
      summary: row.summary,
      concerns,
      generatedAt: row.analysis_generated_at,
      summaryEdited: Boolean(row.summary_edited),
      concernsEdited: Boolean(row.concerns_edited),
    } : null,
  };
}

export class ConversationStore {
  constructor(databasePath) {
    this.databasePath = path.resolve(databasePath);
    fs.mkdirSync(path.dirname(this.databasePath), { recursive: true });
    this.database = null;
    try {
      this.database = new DatabaseSync(this.databasePath);
      this.initialize();
      this.prepareStatements();
    } catch (error) {
      try {
        this.database?.close();
      } catch {
        // Preserve the initialization error if closing the failed connection also fails.
      }
      this.database = null;
      throw error;
    }
  }

  initialize() {
    this.database.exec("PRAGMA journal_mode = WAL");
    this.database.exec("PRAGMA foreign_keys = ON");
    this.database.exec("PRAGMA busy_timeout = 5000");
    const version = this.database.prepare("PRAGMA user_version").get().user_version;
    if (version > 1) {
      throw new ConversationStorageError("STORAGE_UNAVAILABLE", "会话数据库版本过新。", {
        status: 503,
        retryable: false,
      });
    }
    if (version === 1) return;

    this.database.exec(`
      BEGIN;
      CREATE TABLE conversations (
        id TEXT PRIMARY KEY,
        started_at INTEGER NOT NULL,
        ended_at INTEGER NOT NULL,
        duration_seconds INTEGER NOT NULL CHECK (duration_seconds >= 0),
        voice TEXT NOT NULL,
        transcription_status TEXT NOT NULL
          CHECK (transcription_status IN ('complete', 'partial', 'unavailable')),
        transcription_failure_count INTEGER NOT NULL DEFAULT 0
          CHECK (transcription_failure_count >= 0),
        summary TEXT,
        concerns_json TEXT,
        analysis_generated_at TEXT,
        analysis_version INTEGER NOT NULL DEFAULT 0 CHECK (analysis_version >= 0),
        summary_edited INTEGER NOT NULL DEFAULT 0 CHECK (summary_edited IN (0, 1)),
        concerns_edited INTEGER NOT NULL DEFAULT 0 CHECK (concerns_edited IN (0, 1)),
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );
      CREATE INDEX conversations_ended_at_idx ON conversations (ended_at DESC);
      CREATE TABLE transcript_items (
        conversation_id TEXT NOT NULL,
        sequence INTEGER NOT NULL CHECK (sequence > 0),
        analysis_sequence INTEGER,
        item_id TEXT NOT NULL,
        role TEXT NOT NULL CHECK (role IN ('user', 'assistant', 'system')),
        text TEXT NOT NULL,
        status TEXT NOT NULL CHECK (status IN ('completed', 'interrupted', 'error')),
        started_at INTEGER NOT NULL,
        completed_at INTEGER,
        PRIMARY KEY (conversation_id, sequence),
        UNIQUE (conversation_id, analysis_sequence),
        FOREIGN KEY (conversation_id) REFERENCES conversations(id) ON DELETE CASCADE
      );
      CREATE UNIQUE INDEX transcript_items_item_id_idx
        ON transcript_items (conversation_id, item_id);
      PRAGMA user_version = 1;
      COMMIT;
    `);
  }

  prepareStatements() {
    this.upsertConversation = this.database.prepare(`
      INSERT INTO conversations (
        id, started_at, ended_at, duration_seconds, voice,
        transcription_status, transcription_failure_count, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        started_at = excluded.started_at,
        ended_at = excluded.ended_at,
        duration_seconds = excluded.duration_seconds,
        voice = excluded.voice,
        transcription_status = excluded.transcription_status,
        transcription_failure_count = excluded.transcription_failure_count,
        updated_at = excluded.updated_at
    `);
    this.deleteTranscripts = this.database.prepare(
      "DELETE FROM transcript_items WHERE conversation_id = ?",
    );
    this.insertTranscript = this.database.prepare(`
      INSERT INTO transcript_items (
        conversation_id, sequence, analysis_sequence, item_id, role,
        text, status, started_at, completed_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    this.findConversation = this.database.prepare(
      "SELECT * FROM conversations WHERE id = ?",
    );
    this.findTranscripts = this.database.prepare(`
      SELECT sequence, analysis_sequence, item_id, role, text, status, started_at, completed_at
      FROM transcript_items
      WHERE conversation_id = ?
      ORDER BY sequence ASC
    `);
    this.findAnalysisSequences = this.database.prepare(`
      SELECT analysis_sequence
      FROM transcript_items
      WHERE conversation_id = ? AND analysis_sequence IS NOT NULL
    `);
    this.updateAnalysisStatement = this.database.prepare(`
      UPDATE conversations SET
        summary = ?,
        concerns_json = ?,
        analysis_generated_at = ?,
        summary_edited = ?,
        concerns_edited = ?,
        analysis_version = analysis_version + 1,
        updated_at = ?
      WHERE id = ? AND analysis_version = ?
    `);
    this.listStatement = this.database.prepare(`
      SELECT * FROM conversations
      ORDER BY ended_at DESC
      LIMIT 50
    `);
  }

  saveConversation(payload) {
    const conversation = normalizeConversationSnapshot(payload);
    const now = Date.now();
    try {
      this.database.exec("BEGIN IMMEDIATE");
      this.upsertConversation.run(
        conversation.conversationId,
        conversation.startedAt,
        conversation.endedAt,
        conversation.durationSeconds,
        conversation.voice,
        conversation.transcriptionStatus,
        conversation.transcriptionFailureCount,
        now,
        now,
      );
      this.deleteTranscripts.run(conversation.conversationId);
      for (const item of conversation.transcript) {
        this.insertTranscript.run(
          conversation.conversationId,
          item.sequence,
          item.analysisSequence,
          item.itemId,
          item.role,
          item.text,
          item.status,
          item.startedAt,
          item.completedAt,
        );
      }
      this.database.exec("COMMIT");
      return {
        conversationId: conversation.conversationId,
        saved: true,
        transcriptionStatus: conversation.transcriptionStatus,
      };
    } catch (error) {
      try {
        this.database.exec("ROLLBACK");
      } catch {
        // The transaction may already have been closed by SQLite.
      }
      if (error instanceof ConversationStorageError) throw error;
      throw new ConversationStorageError(
        "CONVERSATION_SAVE_FAILED",
        "本次会话暂时无法保存，请重试。",
        { cause: error },
      );
    }
  }

  updateAnalysis(conversationId, payload) {
    if (!UUID_PATTERN.test(conversationId)) throw invalid("conversationId 必须是完整 UUID。");
    const row = this.findConversation.get(conversationId);
    if (!row) {
      throw new ConversationStorageError("CONVERSATION_NOT_FOUND", "未找到本次会话。", {
        status: 404,
        retryable: false,
      });
    }
    if (!payload || typeof payload !== "object") throw invalid("分析请求无效。");
    if (!Number.isSafeInteger(payload.expectedVersion) || payload.expectedVersion < 0) {
      throw invalid("分析版本无效。");
    }
    if (payload.expectedVersion !== row.analysis_version) {
      throw new ConversationStorageError("ANALYSIS_VERSION_CONFLICT", "分析内容已更新，请重新加载。", {
        status: 409,
        retryable: false,
      });
    }

    const validSequences = new Set(
      this.findAnalysisSequences.all(conversationId).map((item) => item.analysis_sequence),
    );
    const summary = requiredText(payload.summary, "摘要", CONVERSATION_LIMITS.summaryChars);
    const concerns = normalizeConcerns(payload.concerns, validSequences);
    const requestedGeneratedAt = typeof payload.generatedAt === "string"
      ? payload.generatedAt.trim()
      : "";
    if (!requestedGeneratedAt || Number.isNaN(Date.parse(requestedGeneratedAt))) {
      throw invalid("分析生成时间无效。");
    }
    if (typeof payload.summaryEdited !== "boolean" || typeof payload.concernsEdited !== "boolean") {
      throw invalid("分析编辑状态无效。");
    }

    let generatedAt = new Date(requestedGeneratedAt).toISOString();
    let summaryEdited = payload.summaryEdited;
    let concernsEdited = payload.concernsEdited;
    if (row.analysis_version > 0) {
      const previous = parseConcerns(row.concerns_json);
      if (!sameConcernStructure(previous, concerns)) {
        throw invalid("已保存关注点的结构和证据不能修改。");
      }
      generatedAt = row.analysis_generated_at;
      summaryEdited ||= Boolean(row.summary_edited);
      concernsEdited ||= Boolean(row.concerns_edited);
    }

    try {
      const result = this.updateAnalysisStatement.run(
        summary,
        JSON.stringify(concerns),
        generatedAt,
        summaryEdited ? 1 : 0,
        concernsEdited ? 1 : 0,
        Date.now(),
        conversationId,
        payload.expectedVersion,
      );
      if (Number(result.changes) !== 1) {
        throw new ConversationStorageError("ANALYSIS_VERSION_CONFLICT", "分析内容已更新，请重新加载。", {
          status: 409,
          retryable: false,
        });
      }
      return { conversationId, saved: true, analysisVersion: payload.expectedVersion + 1 };
    } catch (error) {
      if (error instanceof ConversationStorageError) throw error;
      throw new ConversationStorageError(
        "CONVERSATION_SAVE_FAILED",
        "分析内容暂时无法写入历史，请重试。",
        { cause: error },
      );
    }
  }

  listConversations() {
    try {
      return this.listStatement.all().map((row) => ({
        conversationId: row.id,
        endedAt: row.ended_at,
        durationSeconds: row.duration_seconds,
        voice: row.voice,
        transcriptionStatus: row.transcription_status,
        summaryPreview: typeof row.summary === "string"
          ? row.summary.replace(/\s+/g, " ").trim().slice(0, 120)
          : "",
        hasAnalysis: typeof row.summary === "string" && row.summary.length > 0,
      }));
    } catch (error) {
      throw new ConversationStorageError(
        "CONVERSATION_READ_FAILED",
        "会话历史暂时无法读取，请重试。",
        { cause: error },
      );
    }
  }

  getConversation(conversationId) {
    if (!UUID_PATTERN.test(conversationId)) throw invalid("conversationId 必须是完整 UUID。");
    try {
      const conversation = mapConversationRow(this.findConversation.get(conversationId));
      if (!conversation) {
        throw new ConversationStorageError("CONVERSATION_NOT_FOUND", "未找到本次会话。", {
          status: 404,
          retryable: false,
        });
      }
      const transcript = this.findTranscripts.all(conversationId).map((item) => ({
        id: item.item_id,
        sequence: item.sequence,
        analysisSequence: item.analysis_sequence,
        role: item.role,
        text: item.text,
        status: item.status,
        startedAt: item.started_at,
        completedAt: item.completed_at,
      }));
      return { ...conversation, transcript };
    } catch (error) {
      if (error instanceof ConversationStorageError) throw error;
      throw new ConversationStorageError(
        "CONVERSATION_READ_FAILED",
        "会话历史暂时无法读取，请重试。",
        { cause: error },
      );
    }
  }

  close() {
    this.database?.close();
    this.database = null;
  }
}
