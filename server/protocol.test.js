import { describe, expect, it } from "vitest";

import { parseClientMessage, safeUpstreamError, sessionUpdate } from "./protocol.js";

describe("proxy protocol", () => {
  it("allows audio append and ping events", () => {
    expect(parseClientMessage(Buffer.from(JSON.stringify({
      type: "input_audio_buffer.append",
      audio: "AA==",
    }))).ok).toBe(true);
    expect(parseClientMessage(Buffer.from(JSON.stringify({
      type: "client.ping",
      sentAt: 123,
    }))).kind).toBe("ping");
    expect(parseClientMessage(Buffer.from(JSON.stringify({
      type: "response.cancel",
    }))).ok).toBe(true);
    expect(parseClientMessage(Buffer.from(JSON.stringify({
      type: "input_audio_buffer.commit",
    }))).ok).toBe(true);
  });

  it("rejects unknown and invalid events", () => {
    expect(parseClientMessage(Buffer.from("not json")).code).toBe("INVALID_JSON");
    expect(parseClientMessage(Buffer.from(JSON.stringify({ type: "session.update" }))).code)
      .toBe("EVENT_NOT_ALLOWED");
    expect(parseClientMessage(Buffer.from(JSON.stringify({
      type: "input_audio_buffer.append",
      audio: "",
    }))).code).toBe("INVALID_AUDIO");
  });

  it("builds the approved session update", () => {
    expect(sessionUpdate("longanqian")).toMatchObject({
      type: "session.update",
      session: {
        voice: "longanqian",
        input_audio_format: "pcm",
        output_audio_format: "pcm",
        turn_detection: { type: "server_vad", threshold: 0.5, silence_duration_ms: 500 },
      },
    });
  });

  it("sanitizes upstream errors", () => {
    const sanitized = JSON.parse(safeUpstreamError(JSON.stringify({
      type: "error",
      error: {
        type: "invalid_request_error",
        code: "401",
        message: "invalid key",
        authorization: "secret",
      },
    })));
    expect(sanitized.error).toEqual({
      type: "invalid_request_error",
      code: "401",
      message: "invalid key",
    });
    expect(JSON.stringify(sanitized)).not.toContain("secret");
  });
});
