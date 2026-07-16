export class ConversationApiError extends Error {
  constructor(code, message, { retryable = true, status = 0 } = {}) {
    super(message);
    this.name = "ConversationApiError";
    this.code = code;
    this.retryable = retryable;
    this.status = status;
  }
}

async function requestJson(url, options = {}, fetchImpl = fetch) {
  let response;
  try {
    response = await fetchImpl(url, {
      ...options,
      headers: {
        Accept: "application/json",
        ...(options.body ? { "Content-Type": "application/json" } : {}),
        ...options.headers,
      },
    });
  } catch {
    throw new ConversationApiError(
      "STORAGE_UNREACHABLE",
      "无法连接会话存储服务。",
      { retryable: true },
    );
  }

  const payload = await response.json().catch(() => null);
  if (!response.ok) {
    throw new ConversationApiError(
      payload?.error?.code ?? "STORAGE_REQUEST_FAILED",
      payload?.error?.message ?? "会话存储请求失败。",
      {
        retryable: payload?.error?.retryable !== false,
        status: response.status,
      },
    );
  }
  return payload;
}

export function createConversationPayload(snapshot) {
  return {
    conversationId: snapshot.conversationId,
    startedAt: snapshot.startedAt,
    endedAt: snapshot.endedAt,
    durationSeconds: snapshot.durationSeconds,
    voice: snapshot.voice,
    transcriptionFailureCount: snapshot.transcriptionFailureCount ?? 0,
    transcript: (snapshot.transcript ?? []).map((item) => ({
      id: item.id,
      role: item.role,
      text: item.text,
      status: item.status,
      startedAt: item.startedAt,
      completedAt: item.completedAt,
    })),
  };
}

export function saveConversation(snapshot, { fetchImpl } = {}) {
  return requestJson("/api/conversations", {
    method: "POST",
    body: JSON.stringify(createConversationPayload(snapshot)),
  }, fetchImpl);
}

export function updateConversationAnalysis(conversationId, result, expectedVersion, { fetchImpl } = {}) {
  return requestJson(`/api/conversations/${encodeURIComponent(conversationId)}/analysis`, {
    method: "PATCH",
    body: JSON.stringify({
      summary: result.summary,
      concerns: result.concerns,
      generatedAt: result.generatedAt,
      summaryEdited: Boolean(result.summaryEdited),
      concernsEdited: Boolean(result.concernsEdited),
      expectedVersion,
    }),
  }, fetchImpl);
}

export async function getStorageHealth({ fetchImpl } = {}) {
  const result = await requestJson("/api/health", {}, fetchImpl);
  return Boolean(result?.storageConfigured);
}

export async function listConversations({ fetchImpl } = {}) {
  const result = await requestJson("/api/conversations", {}, fetchImpl);
  return Array.isArray(result?.conversations) ? result.conversations : [];
}

export function getConversation(conversationId, { fetchImpl } = {}) {
  return requestJson(`/api/conversations/${encodeURIComponent(conversationId)}`, {}, fetchImpl);
}
