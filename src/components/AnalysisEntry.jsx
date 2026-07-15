import { AlertCircle, LoaderCircle, RefreshCw, Sparkles } from "lucide-react";

export function AnalysisEntry({ status, error, previous, onOpen, onRetry }) {
  if (status === "idle") return null;

  if (status === "generating") {
    return (
      <span className="analysis-entry analysis-entry--status" role="status">
        <LoaderCircle className="analysis-entry__spinner" size={14} />
        {previous ? "正在分析上一会话" : "正在生成摘要"}
      </span>
    );
  }

  if (status === "ready") {
    return (
      <button className="analysis-entry analysis-entry--ready" type="button" onClick={onOpen}>
        <Sparkles size={14} />
        {previous ? "上一会话分析" : "查看分析"}
      </button>
    );
  }

  if (status === "error" && error?.retryable) {
    return (
      <button className="analysis-entry analysis-entry--error" type="button" onClick={onRetry}>
        <RefreshCw size={14} />
        分析失败 · 重新生成
      </button>
    );
  }

  if (status === "error") {
    return (
      <span
        className="analysis-entry analysis-entry--error analysis-entry--status"
        role="status"
        title={error?.message}
      >
        <AlertCircle size={14} />
        分析暂不可用
      </span>
    );
  }

  if (status === "empty") {
    return <span className="analysis-entry analysis-entry--status">暂无可分析内容</span>;
  }

  return null;
}
