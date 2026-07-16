import { Bot, Radio, UserRound } from "lucide-react";

import { AnalysisEntry } from "./AnalysisEntry.jsx";
import { StorageEntry } from "./StorageEntry.jsx";

function formatTime(timestamp) {
  if (!timestamp) return "刚刚";
  return new Intl.DateTimeFormat("zh-CN", {
    hour: "2-digit",
    minute: "2-digit",
  }).format(timestamp);
}

export function TranscriptPanel({
  transcripts,
  visible,
  elapsed,
  analysis,
  analysisPrevious,
  onOpenAnalysis,
  onRetryAnalysis,
  storageState,
  onRetryStorage,
}) {
  if (!visible) {
    return (
      <aside className="transcript-panel transcript-panel--hidden" aria-label="实时字幕已隐藏">
        <Radio size={20} />
        <p>字幕已隐藏</p>
        <span>再次打开即可恢复本次会话内容</span>
      </aside>
    );
  }

  return (
    <aside className="transcript-panel" aria-label="实时字幕">
      <div className="transcript-panel__header">
        <div>
          <span className="section-kicker">CONVERSATION FEED</span>
          <h2>实时字幕</h2>
        </div>
        <div className="transcript-panel__actions">
          <StorageEntry state={storageState} onRetry={onRetryStorage} />
          <AnalysisEntry
            status={analysis.status}
            error={analysis.error}
            previous={analysisPrevious}
            onOpen={onOpenAnalysis}
            onRetry={onRetryAnalysis}
          />
          <time>{elapsed}</time>
        </div>
      </div>

      <div className="transcript-list" aria-live="polite">
        {transcripts.length === 0 ? (
          <div className="transcript-empty">
            <Radio size={22} />
            <p>对话开始后，双方字幕会在这里逐句出现。</p>
          </div>
        ) : transcripts.map((item) => (
          <article
            className={`transcript transcript--${item.role} transcript--${item.status}`}
            key={item.id}
          >
            <div className="transcript__meta">
              <span>
                {item.role === "user" && <UserRound size={14} />}
                {item.role === "assistant" && <Bot size={14} />}
                {item.role === "system" && <Radio size={14} />}
                {item.role === "user" ? "你" : item.role === "assistant" ? "千问" : "系统"}
                {item.status === "streaming" && <i className="live-marker" />}
              </span>
              <time>{formatTime(item.startedAt)}</time>
            </div>
            <p>{item.text}</p>
          </article>
        ))}
      </div>
    </aside>
  );
}
