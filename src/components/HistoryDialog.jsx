import { ArrowLeft, Clock3, History, Volume2, X } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import {
  analysisFileName,
  buildAnalysisMarkdown,
  concernsText,
  summaryText,
  transcriptText,
} from "../analysis/markdown.js";
import { VOICE_OPTIONS } from "../config/voices.js";
import { AnalysisToolbar } from "./AnalysisToolbar.jsx";
import { ConcernsTab } from "./analysis/ConcernsTab.jsx";
import { OriginalTranscriptTab } from "./analysis/OriginalTranscriptTab.jsx";
import { SummaryTab } from "./analysis/SummaryTab.jsx";

const TABS = [
  { id: "summary", label: "摘要" },
  { id: "concerns", label: "关注点" },
  { id: "original", label: "完整原文" },
];

const DATE_TIME = new Intl.DateTimeFormat("zh-CN", {
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
});

function formatDuration(seconds) {
  const minutes = Math.floor(seconds / 60).toString().padStart(2, "0");
  const remainder = Math.floor(seconds % 60).toString().padStart(2, "0");
  return `${minutes}:${remainder}`;
}

function voiceLabel(value) {
  return VOICE_OPTIONS.find((option) => option.value === value)?.label ?? value;
}

function transcriptionLabel(status) {
  if (status === "partial") return "转写不完整";
  if (status === "unavailable") return "用户转写不可用";
  return "转写完整";
}

export function HistoryDialog({ open, history, onClose }) {
  const dialogRef = useRef(null);
  const tabRefs = useRef(new Map());
  const [selectedId, setSelectedId] = useState(null);
  const [activeTab, setActiveTab] = useState("summary");
  const [targetSequence, setTargetSequence] = useState(null);
  const [copied, setCopied] = useState(false);
  const [mobileDetail, setMobileDetail] = useState(false);
  const detail = history.detailState.item;
  const result = detail?.analysis;

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!open || !dialog) return undefined;
    if (!dialog.open) dialog.showModal();
    setSelectedId(null);
    setActiveTab("summary");
    setMobileDetail(false);
    let active = true;
    history.refreshList().then((items) => {
      if (!active || items.length === 0) return;
      setSelectedId(items[0].conversationId);
      void history.loadDetail(items[0].conversationId);
    });
    return () => {
      active = false;
      if (dialog.open) dialog.close();
      history.clearDetail();
    };
  }, [history.clearDetail, history.loadDetail, history.refreshList, open]);

  const selectConversation = useCallback((conversationId) => {
    setSelectedId(conversationId);
    setActiveTab("summary");
    setTargetSequence(null);
    setMobileDetail(true);
    void history.loadDetail(conversationId);
  }, [history]);

  const snapshot = useMemo(() => detail ? {
    conversationId: detail.conversationId,
    durationSeconds: detail.durationSeconds,
    endedAt: detail.endedAt,
    transcript: detail.transcript,
  } : null, [detail]);

  if (!open) return null;

  const currentText = () => {
    if (!snapshot) return "";
    if (activeTab === "summary") return result ? summaryText(result) : "本次会话暂无分析结果";
    if (activeTab === "concerns") return result ? concernsText(result) : "本次会话暂无分析结果";
    return transcriptText(snapshot);
  };

  const copyCurrent = async () => {
    try {
      await navigator.clipboard.writeText(currentText());
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1_600);
    } catch {
      setCopied(false);
      window.prompt("自动复制失败，请手动复制：", currentText());
    }
  };

  const downloadReport = () => {
    if (!snapshot) return;
    const safeResult = result ?? {
      summary: "本次会话暂无分析结果",
      concerns: [],
      summaryEdited: false,
      concernsEdited: false,
    };
    const blob = new Blob([buildAnalysisMarkdown({ snapshot, result: safeResult })], {
      type: "text/markdown;charset=utf-8",
    });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = analysisFileName(snapshot);
    link.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 0);
  };

  const selectTab = (tab) => {
    setActiveTab(tab);
    tabRefs.current.get(tab)?.focus();
  };

  const onTabKeyDown = (event) => {
    if (!["ArrowLeft", "ArrowRight"].includes(event.key)) return;
    event.preventDefault();
    const index = TABS.findIndex((tab) => tab.id === activeTab);
    const offset = event.key === "ArrowRight" ? 1 : -1;
    selectTab(TABS[(index + offset + TABS.length) % TABS.length].id);
  };

  return (
    <dialog
      className={`history-dialog ${mobileDetail ? "history-dialog--detail" : ""}`}
      ref={dialogRef}
      aria-labelledby="history-dialog-title"
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
      onClose={() => {
        if (open) onClose();
      }}
    >
      <div className="history-dialog__shell">
        <header className="history-dialog__header">
          <div className="analysis-dialog__title">
            <span className="analysis-dialog__icon"><History size={18} /></span>
            <div>
              <span className="section-kicker">LOCAL CONVERSATION ARCHIVE</span>
              <h2 id="history-dialog-title">历史会话</h2>
              <p>最近 50 条 · 本机 SQLite</p>
            </div>
          </div>
          <button className="analysis-close" type="button" onClick={onClose} aria-label="关闭历史会话">
            <X size={18} />
          </button>
        </header>

        <div className="history-dialog__content">
          <aside className="history-list" aria-label="会话列表">
            {history.listState.status === "loading" && (
              <div className="history-state" role="status">正在读取本地历史…</div>
            )}
            {history.listState.status === "error" && (
              <div className="history-state history-state--error">
                <p>{history.listState.error?.message ?? "历史读取失败"}</p>
                <button className="analysis-tool" type="button" onClick={history.refreshList}>重试</button>
              </div>
            )}
            {history.listState.status === "ready" && history.listState.items.length === 0 && (
              <div className="history-state">还没有保存的会话。</div>
            )}
            {history.listState.items.map((item) => (
              <button
                className={`history-list__item ${selectedId === item.conversationId ? "history-list__item--active" : ""}`}
                type="button"
                key={item.conversationId}
                onClick={() => selectConversation(item.conversationId)}
                aria-pressed={selectedId === item.conversationId}
              >
                <span className="history-list__time">{DATE_TIME.format(item.endedAt)}</span>
                <strong>{item.summaryPreview || "暂无分析摘要"}</strong>
                <span className="history-list__meta">
                  <i><Clock3 size={12} />{formatDuration(item.durationSeconds)}</i>
                  <i><Volume2 size={12} />{voiceLabel(item.voice)}</i>
                </span>
                <em className={`history-transcription history-transcription--${item.transcriptionStatus}`}>
                  {transcriptionLabel(item.transcriptionStatus)}
                </em>
              </button>
            ))}
          </aside>

          <section className="history-detail" aria-live="polite">
            <button className="history-back" type="button" onClick={() => setMobileDetail(false)}>
              <ArrowLeft size={16} />返回列表
            </button>
            {history.detailState.status === "idle" && (
              <div className="history-state">选择一条会话查看详情。</div>
            )}
            {history.detailState.status === "loading" && (
              <div className="history-state" role="status">正在加载会话详情…</div>
            )}
            {history.detailState.status === "error" && (
              <div className="history-state history-state--error">
                <p>{history.detailState.error?.message ?? "详情读取失败"}</p>
                <button className="analysis-tool" type="button" onClick={() => history.loadDetail(selectedId)}>重试</button>
              </div>
            )}
            {detail && snapshot && (
              <>
                <div className="history-detail__meta">
                  <div>
                    <span>{DATE_TIME.format(detail.endedAt)}</span>
                    <strong>{formatDuration(detail.durationSeconds)} · {voiceLabel(detail.voice)}</strong>
                  </div>
                  {detail.transcriptionStatus !== "complete" && (
                    <p className="history-warning">
                      {detail.transcriptionStatus === "partial"
                        ? "部分用户语音未能转写，历史文本可能不完整。"
                        : "本次用户语音转写不可用，千问仍可能已理解音频。"}
                    </p>
                  )}
                </div>

                <div className="analysis-dialog__nav history-detail__nav">
                  <div className="analysis-tabs" role="tablist" aria-label="历史会话内容">
                    {TABS.map((tab) => (
                      <button
                        className={activeTab === tab.id ? "analysis-tab analysis-tab--active" : "analysis-tab"}
                        type="button"
                        role="tab"
                        aria-selected={activeTab === tab.id}
                        tabIndex={activeTab === tab.id ? 0 : -1}
                        key={tab.id}
                        ref={(node) => {
                          if (node) tabRefs.current.set(tab.id, node);
                        }}
                        onClick={() => selectTab(tab.id)}
                        onKeyDown={onTabKeyDown}
                      >
                        {tab.label}
                        {tab.id === "concerns" && result?.concerns?.length > 0 && <span>{result.concerns.length}</span>}
                      </button>
                    ))}
                  </div>
                  <AnalysisToolbar
                    canEdit={false}
                    editing={false}
                    copied={copied}
                    onCopy={copyCurrent}
                    onDownload={downloadReport}
                  />
                </div>

                <div className="history-detail__body" role="tabpanel">
                  {activeTab !== "original" && !result && (
                    <div className="analysis-empty">本次会话暂无分析结果。</div>
                  )}
                  {activeTab === "summary" && result && (
                    <SummaryTab summary={result.summary} editing={false} edited={result.summaryEdited} />
                  )}
                  {activeTab === "concerns" && result && (
                    <ConcernsTab
                      concerns={result.concerns}
                      editing={false}
                      onLocate={(sequence) => {
                        setTargetSequence(sequence);
                        setActiveTab("original");
                      }}
                      edited={result.concernsEdited}
                    />
                  )}
                  {activeTab === "original" && (
                    <OriginalTranscriptTab
                      snapshot={snapshot}
                      targetSequence={targetSequence}
                      onTargetHandled={() => setTargetSequence(null)}
                    />
                  )}
                </div>
              </>
            )}
          </section>
        </div>
      </div>
    </dialog>
  );
}
