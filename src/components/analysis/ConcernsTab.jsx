import { ArrowUpRight, CircleAlert } from "lucide-react";

export function ConcernsTab({ concerns, editing, drafts, onDraftChange, onLocate, edited }) {
  return (
    <section className="analysis-section" aria-labelledby="analysis-concerns-heading">
      <div className="analysis-section__heading">
        <h3 id="analysis-concerns-heading">关注点</h3>
        {edited && <span>已编辑</span>}
      </div>
      <p className="analysis-advisory"><CircleAlert size={15} />AI 提示，仅供参考，请结合原文确认。</p>

      {concerns.length === 0 ? (
        <div className="analysis-empty">本次对话未发现需要特别确认的事项。</div>
      ) : (
        <ol className="concern-list">
          {concerns.map((concern, index) => (
            <li key={concern.id}>
              <span className="concern-index">{String(index + 1).padStart(2, "0")}</span>
              <div>
                {editing ? (
                  <textarea
                    className="analysis-editor analysis-editor--concern"
                    value={drafts[index] ?? ""}
                    onChange={(event) => onDraftChange(index, event.target.value)}
                    aria-label={`编辑第 ${index + 1} 条关注点`}
                  />
                ) : <p>{concern.text}</p>}
                {!editing && (
                  <button
                    className="analysis-source-link"
                    type="button"
                    onClick={() => onLocate(concern.evidenceSequences[0])}
                  >
                    查看原文 <ArrowUpRight size={14} />
                  </button>
                )}
              </div>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}
