import { AnalysisError, analyzeConversation } from "./analysis.js";

export function createAnalysisHandler({ config, fetchImpl = fetch, logger = console } = {}) {
  return async function analysisHandler(request, response) {
    const startedAt = Date.now();
    const requestId = crypto.randomUUID().slice(0, 8);
    const origin = request.headers.origin;

    if (origin && !config.allowedOrigins.has(origin)) {
      sendError(response, new AnalysisError(
        "ANALYSIS_ORIGIN_FORBIDDEN",
        "当前站点不能调用会话分析服务。",
        { status: 403, retryable: false },
      ));
      return;
    }

    try {
      const result = await analyzeConversation(request.body, {
        apiKey: config.apiKey,
        fetchImpl,
        signal: request.signal,
      });
      logger.info?.(`[analysis:${requestId}] completed (${Date.now() - startedAt} ms)`);
      response.json(result);
    } catch (error) {
      const safeError = error instanceof AnalysisError
        ? error
        : new AnalysisError(
          "ANALYSIS_INTERNAL_ERROR",
          "会话分析服务暂不可用。",
          { status: 500, retryable: true },
        );
      logger.warn?.(
        `[analysis:${requestId}] ${safeError.code} (${Date.now() - startedAt} ms)`,
      );
      sendError(response, safeError);
    }
  };
}

export function analysisJsonErrorHandler(error, _request, response, next) {
  if (error?.type === "entity.too.large") {
    sendError(response, new AnalysisError(
      "ANALYSIS_TOO_LARGE",
      "会话内容过长，无法生成分析。",
      { status: 413, retryable: false },
    ));
    return;
  }
  if (error instanceof SyntaxError && "body" in error) {
    sendError(response, new AnalysisError(
      "ANALYSIS_INVALID_JSON",
      "请求 JSON 格式无效。",
      { status: 400, retryable: false },
    ));
    return;
  }
  next(error);
}

function sendError(response, error) {
  response.status(error.status).json({
    error: {
      code: error.code,
      message: error.message,
      retryable: error.retryable,
    },
  });
}
