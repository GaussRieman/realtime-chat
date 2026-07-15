import { Sparkles, X } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import {
  analysisFileName,
  buildAnalysisMarkdown,
  concernsText,
  summaryText,
  transcriptText,
} from "../analysis/markdown.js";
import { AnalysisToolbar } from "./AnalysisToolbar.jsx";
import { ConcernsTab } from "./analysis/ConcernsTab.jsx";
import { OriginalTranscriptTab } from "./analysis/OriginalTranscriptTab.jsx";
import { SummaryTab } from "./analysis/SummaryTab.jsx";

const TABS = [
  { id: "summary", label: "摘要" },
  { id: "concerns", label: "关注点" },
  { id: "original", label: "完整原文" },
];

function formatDuration(seconds) {
  const minutes = Math.floor(seconds / 60).toString().padStart(2, "0");
  const remainder = Math.floor(seconds % 60).toString().padStart(2, "0");
  return `${minutes}:${remainder}`;
}

export function AnalysisDialog({ open, analysis, onClose }) {
  const dialogRef = useRef(null);
  const tabRefs = useRef(new Map());
  const [activeTab, setActiveTab] = useState("summary");
  const [editing, setEditing] = useState(null);
  const [summaryDraft, setSummaryDraft] = useState("");
  const [concernDrafts, setConcernDrafts] = useState([]);
  const [copied, setCopied] = useState(false);
  const [targetSequence, setTargetSequence] = useState(null);
  const result = analysis.result;
  const snapshot = analysis.snapshot;

  const isDirty = useMemo(() => {
    if (editing === "summary") return summaryDraft !== result?.summary;
    if (editing === "concerns") {
      return concernDrafts.some((text, index) => text !== result?.concerns[index]?.text);
    }
    return false;
  }, [concernDrafts, editing, result, summaryDraft]);

  const confirmDiscard = useCallback(() => (
    !isDirty || window.confirm("放弃尚未保存的修改？")
  ), [isDirty]);

  const closeDialog = useCallback(() => {
    if (!confirmDiscard()) return;
    setEditing(null);
    onClose();
  }, [confirmDiscard, onClose]);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!open || !dialog) return undefined;
    if (!dialog.open) dialog.showModal();
    setActiveTab("summary");
    setEditing(null);
    setTargetSequence(null);
    return () => {
      if (dialog.open) dialog.close();
    };
  }, [open]);

  useEffect(() => {
    if (!open) return undefined;
    const beforeUnload = (event) => {
      if (!isDirty) return;
      event.preventDefault();
    };
    window.addEventListener("beforeunload", beforeUnload);
    return () => window.removeEventListener("beforeunload", beforeUnload);
  }, [isDirty, open]);

  if (!open || !result || !snapshot) return null;

  const selectTab = (tab) => {
    if (tab === activeTab) return;
    if (!confirmDiscard()) return;
    setEditing(null);
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

  const beginEdit = () => {
    if (activeTab === "summary") {
      setSummaryDraft(result.summary);
      setEditing("summary");
    } else if (activeTab === "concerns" && result.concerns.length) {
      setConcernDrafts(result.concerns.map((item) => item.text));
      setEditing("concerns");
    }
  };

  const saveEdit = () => {
    if (editing === "summary") {
      if (!summaryDraft.trim()) return;
      analysis.saveSummary(summaryDraft);
    }
    if (editing === "concerns") {
      if (!concernDrafts.every((item) => item.trim())) return;
      analysis.saveConcerns(concernDrafts);
    }
    setEditing(null);
  };

  const currentText = () => {
    if (activeTab === "summary") return summaryText(result);
    if (activeTab === "concerns") return concernsText(result);
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
    const blob = new Blob([buildAnalysisMarkdown({ snapshot, result })], {
      type: "text/markdown;charset=utf-8",
    });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = analysisFileName(snapshot);
    link.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 0);
  };

  const locateOriginal = (sequence) => {
    setEditing(null);
    setTargetSequence(sequence);
    setActiveTab("original");
  };

  const canEdit = activeTab === "summary"
    || (activeTab === "concerns" && result.concerns.length > 0);

  return (
    <dialog
      className="analysis-dialog"
      ref={dialogRef}
      aria-labelledby="analysis-dialog-title"
      onCancel={(event) => {
        event.preventDefault();
        closeDialog();
      }}
      onClose={() => {
        if (open) onClose();
      }}
    >
      <div className="analysis-dialog__shell">
        <header className="analysis-dialog__header">
          <div className="analysis-dialog__title">
            <span className="analysis-dialog__icon"><Sparkles size={18} /></span>
            <div>
              <span className="section-kicker">QWEN 3.7 MAX ANALYSIS</span>
              <h2 id="analysis-dialog-title">会话分析</h2>
              <p>{formatDuration(snapshot.durationSeconds)} · {snapshot.transcript.length} 条记录</p>
            </div>
          </div>
          <button className="analysis-close" type="button" onClick={closeDialog} aria-label="关闭会话分析">
            <X size={18} />
          </button>
        </header>

        <div className="analysis-dialog__nav">
          <div className="analysis-tabs" role="tablist" aria-label="会话分析内容">
            {TABS.map((tab) => (
              <button
                className={activeTab === tab.id ? "analysis-tab analysis-tab--active" : "analysis-tab"}
                type="button"
                role="tab"
                aria-selected={activeTab === tab.id}
                tabIndex={activeTab === tab.id ? 0 : -1}
                aria-controls={`analysis-panel-${tab.id}`}
                id={`analysis-tab-${tab.id}`}
                key={tab.id}
                ref={(node) => {
                  if (node) tabRefs.current.set(tab.id, node);
                }}
                onClick={() => selectTab(tab.id)}
                onKeyDown={onTabKeyDown}
              >
                {tab.label}
                {tab.id === "concerns" && result.concerns.length > 0 && <span>{result.concerns.length}</span>}
              </button>
            ))}
          </div>
          <AnalysisToolbar
            canEdit={canEdit}
            editing={Boolean(editing)}
            copied={copied}
            onCopy={copyCurrent}
            onDownload={downloadReport}
            onEdit={beginEdit}
            onSave={saveEdit}
            onCancel={() => setEditing(null)}
          />
        </div>

        <div
          className="analysis-dialog__body"
          id={`analysis-panel-${activeTab}`}
          role="tabpanel"
          aria-labelledby={`analysis-tab-${activeTab}`}
        >
          {activeTab === "summary" && (
            <SummaryTab
              summary={result.summary}
              editing={editing === "summary"}
              draft={summaryDraft}
              onDraftChange={setSummaryDraft}
              edited={result.summaryEdited}
            />
          )}
          {activeTab === "concerns" && (
            <ConcernsTab
              concerns={result.concerns}
              editing={editing === "concerns"}
              drafts={concernDrafts}
              onDraftChange={(index, value) => setConcernDrafts((current) => (
                current.map((item, itemIndex) => itemIndex === index ? value : item)
              ))}
              onLocate={locateOriginal}
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
      </div>
    </dialog>
  );
}
