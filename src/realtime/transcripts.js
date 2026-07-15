const STORAGE_KEY = "audio-anything-transcript";

export function createTranscript(role, text, options = {}) {
  return {
    id: options.id ?? crypto.randomUUID(),
    role,
    text,
    status: options.status ?? "completed",
    startedAt: options.startedAt ?? Date.now(),
    completedAt: options.status === "streaming" ? null : Date.now(),
  };
}

export function upsertTranscript(items, next) {
  const index = items.findIndex((item) => item.id === next.id);
  if (index === -1) return [...items, next];
  return items.map((item, itemIndex) => itemIndex === index ? { ...item, ...next } : item);
}

export function loadTranscripts() {
  try {
    const parsed = JSON.parse(sessionStorage.getItem(STORAGE_KEY) ?? "[]");
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function saveTranscripts(items) {
  sessionStorage.setItem(STORAGE_KEY, JSON.stringify(items));
}

export function clearTranscripts() {
  sessionStorage.removeItem(STORAGE_KEY);
}
