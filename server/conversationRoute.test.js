import { describe, expect, it, vi } from "vitest";

import {
  conversationJsonErrorHandler,
  createConversationHandlers,
} from "./conversationRoute.js";

function createResponse() {
  return {
    statusCode: 200,
    payload: null,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(payload) {
      this.payload = payload;
      return this;
    },
  };
}

describe("conversation routes", () => {
  it("maps storage operations without logging content", () => {
    const store = {
      saveConversation: vi.fn(() => ({ saved: true })),
      updateAnalysis: vi.fn(() => ({ saved: true, analysisVersion: 1 })),
      listConversations: vi.fn(() => []),
      getConversation: vi.fn(() => ({ conversationId: "id" })),
    };
    const logger = { warn: vi.fn() };
    const handlers = createConversationHandlers({
      store,
      config: { allowedOrigins: new Set(["http://localhost:5173"]) },
      logger,
    });

    const saveResponse = createResponse();
    handlers.save({ body: { secret: "正文" }, headers: {} }, saveResponse);
    expect(saveResponse.payload).toEqual({ saved: true });

    const listResponse = createResponse();
    handlers.list({ headers: {} }, listResponse);
    expect(listResponse.payload).toEqual({ conversations: [] });

    const analysisResponse = createResponse();
    handlers.updateAnalysis({
      params: { conversationId: "id" },
      body: { summary: "摘要" },
      headers: {},
    }, analysisResponse);
    expect(store.updateAnalysis).toHaveBeenCalledWith("id", { summary: "摘要" });
    expect(analysisResponse.payload).toEqual({ saved: true, analysisVersion: 1 });

    const detailResponse = createResponse();
    handlers.detail({ params: { conversationId: "id" }, headers: {} }, detailResponse);
    expect(detailResponse.payload).toEqual({ conversationId: "id" });
    expect(JSON.stringify(logger.warn.mock.calls)).not.toContain("正文");
  });

  it("rejects unknown origins and unavailable storage", () => {
    const forbidden = createResponse();
    createConversationHandlers({
      store: {},
      config: { allowedOrigins: new Set() },
    }).list({ headers: { origin: "https://evil.example" } }, forbidden);
    expect(forbidden.statusCode).toBe(403);

    const unavailable = createResponse();
    createConversationHandlers({
      store: null,
      config: { allowedOrigins: new Set() },
    }).list({ headers: {} }, unavailable);
    expect(unavailable.statusCode).toBe(503);
    expect(unavailable.payload.error.code).toBe("STORAGE_UNAVAILABLE");
  });
});

describe("conversation JSON errors", () => {
  it("maps body limit and syntax errors", () => {
    const tooLarge = createResponse();
    conversationJsonErrorHandler({ type: "entity.too.large" }, {}, tooLarge, vi.fn());
    expect(tooLarge.payload.error.code).toBe("CONVERSATION_TOO_LARGE");

    const invalid = createResponse();
    const syntaxError = new SyntaxError("invalid");
    syntaxError.body = "{";
    conversationJsonErrorHandler(syntaxError, {}, invalid, vi.fn());
    expect(invalid.payload.error.code).toBe("CONVERSATION_INVALID");
  });
});
