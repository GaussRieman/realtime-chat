import { AlertCircle, CheckCircle2, LoaderCircle, RefreshCw } from "lucide-react";

export function StorageEntry({ state, onRetry }) {
  if (state.status === "saving") {
    return (
      <span className="analysis-entry analysis-entry--status" role="status">
        <LoaderCircle className="analysis-entry__spinner" size={14} />
        正在保存记录
      </span>
    );
  }
  if (state.status === "error") {
    return (
      <button
        className="analysis-entry analysis-entry--error"
        type="button"
        onClick={onRetry}
        title={state.error?.message}
      >
        <RefreshCw size={14} />
        记录未保存 · 重试
      </button>
    );
  }
  if (state.status === "unavailable") {
    return (
      <span className="analysis-entry analysis-entry--error analysis-entry--status" role="status">
        <AlertCircle size={14} />
        存储不可用
      </span>
    );
  }
  if (state.status === "saved") {
    return (
      <span className="analysis-entry analysis-entry--status" role="status">
        <CheckCircle2 size={14} />
        记录已保存
      </span>
    );
  }
  return null;
}
