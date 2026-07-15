const DATE_TIME = new Intl.DateTimeFormat("zh-CN", {
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
});

const CLOCK_TIME = new Intl.DateTimeFormat("zh-CN", {
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  hour12: false,
});

export function summaryText(result) {
  return result?.summary ?? "";
}

export function concernsText(result) {
  if (!result?.concerns?.length) return "本次对话未发现需要特别确认的事项。";
  return result.concerns.map((item, index) => `${index + 1}. ${item.text}`).join("\n");
}

export function transcriptText(snapshot) {
  return (snapshot?.transcript ?? []).filter((item) => (
    ["user", "assistant"].includes(item.role) && item.text?.trim()
  )).map((item) => {
    const role = item.role === "user" ? "你" : "千问";
    const time = item.startedAt ? CLOCK_TIME.format(item.startedAt) : "--:--:--";
    const interrupted = item.status === "interrupted" ? "（被打断）" : "";
    return `[${time}] ${role}${interrupted}: ${item.text.trim()}`;
  }).join("\n");
}

export function buildAnalysisMarkdown({ snapshot, result }) {
  const endedAt = snapshot?.endedAt ?? Date.now();
  const duration = formatDuration(snapshot?.durationSeconds ?? 0);
  const summaryLabel = result?.summaryEdited ? "摘要（已编辑）" : "摘要";
  const concernsLabel = result?.concernsEdited ? "关注点（已编辑）" : "关注点";

  return [
    "# Audio Anything 会话分析",
    "",
    `- 会话 ID：${snapshot?.conversationId ?? "-"}`,
    `- 会话时长：${duration}`,
    `- 结束时间：${DATE_TIME.format(endedAt)}`,
    `- 分析模型：Qwen 3.7 Max`,
    "",
    `## ${summaryLabel}`,
    "",
    summaryText(result),
    "",
    `## ${concernsLabel}`,
    "",
    concernsText(result),
    "",
    "## 完整原文",
    "",
    transcriptText(snapshot),
    "",
  ].join("\n");
}

export function analysisFileName(snapshot) {
  const date = new Date(snapshot?.endedAt ?? Date.now());
  const stamp = [
    date.getFullYear(),
    String(date.getMonth() + 1).padStart(2, "0"),
    String(date.getDate()).padStart(2, "0"),
    "-",
    String(date.getHours()).padStart(2, "0"),
    String(date.getMinutes()).padStart(2, "0"),
  ].join("");
  return `audio-anything-${snapshot?.conversationId ?? "conversation"}-${stamp}.md`;
}

function formatDuration(seconds) {
  const minutes = Math.floor(seconds / 60).toString().padStart(2, "0");
  const remainder = Math.floor(seconds % 60).toString().padStart(2, "0");
  return `${minutes}:${remainder}`;
}
