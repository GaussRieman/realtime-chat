export function classifyRealtimeError(event) {
  const error = event.error ?? {};
  const code = String(error.code ?? "UPSTREAM_ERROR");
  const message = String(error.message ?? "实时语音服务出现异常。");
  const category = String(error.type ?? event.error_type ?? "");
  const normalizedMessage = message.toLowerCase();

  if (
    normalizedMessage.includes("no active response") ||
    normalizedMessage.includes("conversation has no active response")
  ) {
    return { action: "ignore", code, message };
  }

  if (category === "invalid_request_error" || code === "invalid_request_error") {
    return { action: "notice", code, message };
  }

  if (category === "server_error" || code === "server_error") {
    return { action: "disconnect", code, message };
  }

  return {
    action: event.type === "proxy.error" && error.recoverable !== true
      ? "disconnect"
      : "notice",
    code,
    message,
  };
}
