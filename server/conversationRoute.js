import { ConversationStorageError } from "./conversationStore.js";

function storageUnavailable(response) {
  response.status(503).json({
    error: {
      code: "STORAGE_UNAVAILABLE",
      message: "会话存储暂不可用。",
      retryable: true,
    },
  });
}

function sendError(response, error, logger = console) {
  const safeError = error instanceof ConversationStorageError
    ? error
    : new ConversationStorageError(
      "CONVERSATION_SAVE_FAILED",
      "会话存储暂时不可用，请重试。",
      { cause: error },
    );
  logger.warn?.(`[storage] ${safeError.code}`);
  response.status(safeError.status).json({
    error: {
      code: safeError.code,
      message: safeError.message,
      retryable: safeError.retryable,
    },
  });
}

function originAllowed(request, config) {
  const origin = request.headers.origin;
  return !origin || config.allowedOrigins.has(origin);
}

export function createConversationHandlers({ store, config, logger = console } = {}) {
  const requireStore = (response) => {
    if (store) return true;
    storageUnavailable(response);
    return false;
  };
  const requireOrigin = (request, response) => {
    if (originAllowed(request, config)) return true;
    response.status(403).json({
      error: {
        code: "CONVERSATION_ORIGIN_FORBIDDEN",
        message: "当前站点不能访问会话存储。",
        retryable: false,
      },
    });
    return false;
  };

  return {
    save(request, response) {
      if (!requireOrigin(request, response) || !requireStore(response)) return;
      try {
        response.json(store.saveConversation(request.body));
      } catch (error) {
        sendError(response, error, logger);
      }
    },
    updateAnalysis(request, response) {
      if (!requireOrigin(request, response) || !requireStore(response)) return;
      try {
        response.json(store.updateAnalysis(request.params.conversationId, request.body));
      } catch (error) {
        sendError(response, error, logger);
      }
    },
    list(request, response) {
      if (!requireOrigin(request, response) || !requireStore(response)) return;
      try {
        response.json({ conversations: store.listConversations() });
      } catch (error) {
        sendError(response, error, logger);
      }
    },
    detail(request, response) {
      if (!requireOrigin(request, response) || !requireStore(response)) return;
      try {
        response.json(store.getConversation(request.params.conversationId));
      } catch (error) {
        sendError(response, error, logger);
      }
    },
  };
}

export function conversationJsonErrorHandler(error, _request, response, next) {
  if (error?.type === "entity.too.large") {
    response.status(413).json({
      error: {
        code: "CONVERSATION_TOO_LARGE",
        message: "本次会话内容过长，无法保存。",
        retryable: false,
      },
    });
    return;
  }
  if (error instanceof SyntaxError && "body" in error) {
    response.status(400).json({
      error: {
        code: "CONVERSATION_INVALID",
        message: "请求 JSON 格式无效。",
        retryable: false,
      },
    });
    return;
  }
  next(error);
}
