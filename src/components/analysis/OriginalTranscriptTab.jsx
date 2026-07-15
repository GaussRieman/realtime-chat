import { Bot, UserRound } from "lucide-react";
import { useEffect, useMemo, useRef } from "react";

function formatTime(timestamp) {
  if (!timestamp) return "--:--";
  return new Intl.DateTimeFormat("zh-CN", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).format(timestamp);
}

export function OriginalTranscriptTab({ snapshot, targetSequence, onTargetHandled }) {
  const itemRefs = useRef(new Map());
  const rows = useMemo(() => {
    let sequence = 0;
    return (snapshot?.transcript ?? []).flatMap((item) => {
      if (!["user", "assistant"].includes(item.role) || !item.text?.trim()) return [];
      sequence += 1;
      return [{ ...item, sequence }];
    });
  }, [snapshot]);

  useEffect(() => {
    if (!targetSequence) return;
    const element = itemRefs.current.get(targetSequence);
    if (!element) return;
    element.scrollIntoView({ block: "center", behavior: "smooth" });
    element.focus({ preventScroll: true });
    const timer = window.setTimeout(onTargetHandled, 1_800);
    return () => window.clearTimeout(timer);
  }, [onTargetHandled, targetSequence]);

  return (
    <section className="analysis-section" aria-labelledby="analysis-original-heading">
      <div className="analysis-section__heading">
        <h3 id="analysis-original-heading">完整原文</h3>
        <span>{rows.length} 条</span>
      </div>
      <div className="original-transcript">
        {rows.map((item) => (
          <article
            className={`original-row original-row--${item.role} ${targetSequence === item.sequence ? "original-row--target" : ""}`}
            key={item.id}
            ref={(node) => {
              if (node) itemRefs.current.set(item.sequence, node);
              else itemRefs.current.delete(item.sequence);
            }}
            tabIndex={-1}
          >
            <div className="original-row__meta">
              <span>
                {item.role === "user" ? <UserRound size={14} /> : <Bot size={14} />}
                {item.role === "user" ? "你" : "千问"}
                {item.status === "interrupted" && <em>被打断</em>}
              </span>
              <time>{formatTime(item.startedAt)}</time>
            </div>
            <p>{item.text.trim()}</p>
          </article>
        ))}
      </div>
    </section>
  );
}
