const ANALYZABLE_ROLES = new Set(["user", "assistant"]);
const ANALYZABLE_STATUSES = new Set(["completed", "interrupted"]);

export function createAnalysisPayload(snapshot) {
  if (!snapshot?.conversationId || !Array.isArray(snapshot.transcript)) return null;

  const transcript = snapshot.transcript
    .filter((item) => (
      ANALYZABLE_ROLES.has(item.role)
      && ANALYZABLE_STATUSES.has(item.status)
      && typeof item.text === "string"
      && item.text.trim()
    ))
    .map((item, index) => ({
      id: item.id,
      sequence: index + 1,
      role: item.role,
      text: item.text.trim(),
      status: item.status,
      startedAt: item.startedAt,
    }));

  if (transcript.length === 0) return null;
  return { conversationId: snapshot.conversationId, transcript };
}
