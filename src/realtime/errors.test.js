import { describe, expect, it } from "vitest";

import { classifyRealtimeError } from "./errors.js";

describe("classifyRealtimeError", () => {
  it("ignores cancel races with no active response", () => {
    expect(classifyRealtimeError({
      type: "error",
      error: { type: "invalid_request_error", message: "Conversation has no active response." },
    }).action).toBe("ignore");
  });

  it("keeps the connection for invalid requests", () => {
    expect(classifyRealtimeError({
      type: "error",
      error: { type: "invalid_request_error", message: "Invalid option" },
    }).action).toBe("notice");
  });

  it("disconnects for server and unrecoverable proxy errors", () => {
    expect(classifyRealtimeError({
      type: "error",
      error: { type: "server_error", message: "Internal failure" },
    }).action).toBe("disconnect");
    expect(classifyRealtimeError({
      type: "proxy.error",
      error: { code: "UPSTREAM_CONNECTION_FAILED", message: "Failed", recoverable: false },
    }).action).toBe("disconnect");
  });
});
