import { MAX_CLIENT_MESSAGE_BYTES } from "./config.js";

const CLIENT_EVENTS = new Set([
  "input_audio_buffer.append",
  "input_audio_buffer.commit",
  "response.cancel",
]);

export function parseClientMessage(raw) {
  const byteLength = Buffer.isBuffer(raw)
    ? raw.byteLength
    : Buffer.byteLength(String(raw));

  if (byteLength > MAX_CLIENT_MESSAGE_BYTES) {
    return { ok: false, code: "MESSAGE_TOO_LARGE", message: "音频消息过大" };
  }

  let event;
  try {
    event = JSON.parse(raw.toString());
  } catch {
    return { ok: false, code: "INVALID_JSON", message: "消息格式无效" };
  }

  if (event.type === "client.ping" && Number.isFinite(event.sentAt)) {
    return { ok: true, kind: "ping", event };
  }

  if (!CLIENT_EVENTS.has(event.type)) {
    return { ok: false, code: "EVENT_NOT_ALLOWED", message: "不支持的实时事件" };
  }

  if (
    event.type === "input_audio_buffer.append" &&
    (typeof event.audio !== "string" || event.audio.length === 0)
  ) {
    return { ok: false, code: "INVALID_AUDIO", message: "音频载荷无效" };
  }

  return { ok: true, kind: "upstream", event };
}

export function sessionUpdate(voice) {
  return {
    event_id: `event_${Date.now()}`,
    type: "session.update",
    session: {
      modalities: ["text", "audio"],
      voice,
      input_audio_format: "pcm",
      output_audio_format: "pcm",
      turn_detection: {
        type: "server_vad",
        threshold: 0.5,
        silence_duration_ms: 500,
      },
    },
  };
}

export function clientError(code, message, recoverable = true) {
  return JSON.stringify({
    type: "proxy.error",
    error: { code, message, recoverable },
  });
}

export function safeUpstreamError(rawMessage) {
  try {
    const event = JSON.parse(rawMessage.toString());
    if (event.type !== "error") return rawMessage.toString();

    return JSON.stringify({
      type: "error",
      error: {
        type: event.error?.type ?? event.error_type,
        code: event.error?.code ?? "UPSTREAM_ERROR",
        message: event.error?.message ?? "实时语音服务返回错误",
      },
    });
  } catch {
    return JSON.stringify({
      type: "proxy.error",
      error: {
        code: "UPSTREAM_MESSAGE_INVALID",
        message: "实时语音服务返回了无法识别的消息",
        recoverable: false,
      },
    });
  }
}
