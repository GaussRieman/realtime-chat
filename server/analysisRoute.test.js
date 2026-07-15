import { describe, expect, it, vi } from "vitest";

import { analysisJsonErrorHandler, createAnalysisHandler } from "./analysisRoute.js";

const conversationId = "550e8400-e29b-41d4-a716-446655440000";
const body = {
  conversationId,
  transcript: [{
    id: "u-1",
    sequence: 1,
    role: "user",
    text: "总结这次对话。",
    status: "completed",
    startedAt: 1,
  }],
};

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

describe("analysis route", () => {
  it("returns a structured analysis without logging transcript content", async () => {
    const fetchImpl = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({
        choices: [{ message: { content: JSON.stringify({ summary: "摘要", concerns: [] }) } }],
      }),
    }));
    const logger = { info: vi.fn(), warn: vi.fn() };
    const handler = createAnalysisHandler({
      config: {
        apiKey: "secret",
        allowedOrigins: new Set(["http://localhost:5173"]),
      },
      fetchImpl,
      logger,
    });
    const response = createResponse();

    await handler({
      body,
      headers: { origin: "http://localhost:5173" },
    }, response);

    expect(response.statusCode).toBe(200);
    expect(response.payload).toMatchObject({ conversationId, summary: "摘要" });
    expect(JSON.stringify(logger.info.mock.calls)).not.toContain("总结这次对话");
  });

  it("rejects unknown origins before calling upstream", async () => {
    const fetchImpl = vi.fn();
    const handler = createAnalysisHandler({
      config: {
        apiKey: "secret",
        allowedOrigins: new Set(["http://localhost:5173"]),
      },
      fetchImpl,
      logger: {},
    });
    const response = createResponse();

    await handler({ body, headers: { origin: "https://evil.example" } }, response);

    expect(response.statusCode).toBe(403);
    expect(response.payload.error).toMatchObject({
      code: "ANALYSIS_ORIGIN_FORBIDDEN",
      retryable: false,
    });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("returns a stable non-retryable error without a key", async () => {
    const handler = createAnalysisHandler({
      config: { apiKey: "", allowedOrigins: new Set() },
      logger: {},
    });
    const response = createResponse();

    await handler({ body, headers: {} }, response);

    expect(response.statusCode).toBe(503);
    expect(response.payload.error).toEqual({
      code: "ANALYSIS_NOT_CONFIGURED",
      message: "会话分析服务尚未配置。",
      retryable: false,
    });
  });
});

describe("analysis JSON errors", () => {
  it("maps body limit and syntax errors", () => {
    const tooLarge = createResponse();
    analysisJsonErrorHandler({ type: "entity.too.large" }, {}, tooLarge, vi.fn());
    expect(tooLarge.statusCode).toBe(413);

    const invalid = createResponse();
    const syntaxError = new SyntaxError("invalid");
    syntaxError.body = "{";
    analysisJsonErrorHandler(syntaxError, {}, invalid, vi.fn());
    expect(invalid.payload.error.code).toBe("ANALYSIS_INVALID_JSON");
  });
});
