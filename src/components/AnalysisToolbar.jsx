import { Check, Copy, Download, Pencil, Save, X } from "lucide-react";

export function AnalysisToolbar({
  canEdit,
  editing,
  copied,
  onCopy,
  onDownload,
  onEdit,
  onSave,
  onCancel,
}) {
  return (
    <div className="analysis-toolbar" aria-label="报告操作">
      {editing ? (
        <>
          <button className="analysis-tool analysis-tool--primary" type="button" onClick={onSave}>
            <Save size={15} />保存
          </button>
          <button className="analysis-tool" type="button" onClick={onCancel}>
            <X size={15} />取消
          </button>
        </>
      ) : (
        <>
          <button className="analysis-tool" type="button" onClick={onCopy}>
            {copied ? <Check size={15} /> : <Copy size={15} />}
            {copied ? "已复制" : "复制"}
          </button>
          {canEdit && (
            <button className="analysis-tool" type="button" onClick={onEdit}>
              <Pencil size={15} />编辑
            </button>
          )}
          <button className="analysis-tool" type="button" onClick={onDownload}>
            <Download size={15} />下载
          </button>
        </>
      )}
    </div>
  );
}
