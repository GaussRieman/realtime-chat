export class ConversationAnalysisApiError extends Error {
  constructor(message, { code = "ANALYSIS_REQUEST_FAILED", retryable = true, status } = {}) {
    super(message);
    this.name = "ConversationAnalysisApiError";
    this.code = code;
    this.retryable = retryable;
    this.status = status;
  }
}

export async function requestConversationAnalysis(
  payload,
  { signal, fetchImpl = fetch } = {},
) {
  let response;
  try {
    response = await fetchImpl("/api/conversation-analysis", {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
      signal,
    });
  } catch (error) {
    if (error?.name === "AbortError") throw error;
    throw new ConversationAnalysisApiError("无法连接会话分析服务，请稍后重试。", {
      code: "ANALYSIS_UNREACHABLE",
      retryable: true,
    });
  }

  let body;
  try {
    body = await response.json();
  } catch {
    throw new ConversationAnalysisApiError("会话分析服务返回了无效内容。", {
      code: "ANALYSIS_INVALID_RESPONSE",
      retryable: true,
      status: response.status,
    });
  }

  if (!response.ok) {
    throw new ConversationAnalysisApiError(
      body?.error?.message ?? "暂时无法生成会话分析。",
      {
        code: body?.error?.code,
        retryable: Boolean(body?.error?.retryable),
        status: response.status,
      },
    );
  }

  return body;
}
