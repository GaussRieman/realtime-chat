export function SummaryTab({ summary, editing, draft, onDraftChange, edited }) {
  return (
    <section className="analysis-section" aria-labelledby="analysis-summary-heading">
      <div className="analysis-section__heading">
        <h3 id="analysis-summary-heading">会话摘要</h3>
        {edited && <span>已编辑</span>}
      </div>
      {editing ? (
        <textarea
          className="analysis-editor"
          value={draft}
          onChange={(event) => onDraftChange(event.target.value)}
          aria-label="编辑会话摘要"
          autoFocus
        />
      ) : (
        <div className="analysis-prose">
          {summary.split(/\n{2,}/).map((paragraph, index) => <p key={index}>{paragraph}</p>)}
        </div>
      )}
    </section>
  );
}
