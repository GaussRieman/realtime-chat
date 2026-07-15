import { describe, expect, it } from "vitest";

import {
  createTranscript,
  finalizeTranscriptSnapshot,
  upsertTranscript,
} from "./transcripts.js";

describe("transcripts", () => {
  it("adds and updates transcript items by id", () => {
    const first = createTranscript("assistant", "你", { id: "item-1", status: "streaming" });
    const created = upsertTranscript([], first);
    const completed = upsertTranscript(created, {
      ...first,
      text: "你好",
      status: "completed",
    });
    expect(completed).toHaveLength(1);
    expect(completed[0]).toMatchObject({ id: "item-1", text: "你好", status: "completed" });
  });

  it("freezes an immutable ended snapshot and normalizes streaming text", () => {
    const snapshot = finalizeTranscriptSnapshot([
      createTranscript("assistant", "部分回答", { id: "stream", status: "streaming" }),
      createTranscript("assistant", "", { id: "empty", status: "streaming" }),
      createTranscript("user", "完整问题", { id: "done" }),
    ], 100);

    expect(snapshot).toHaveLength(2);
    expect(snapshot[0]).toMatchObject({
      id: "stream",
      text: "部分回答",
      status: "interrupted",
      completedAt: 100,
    });
    expect(Object.isFrozen(snapshot)).toBe(true);
    expect(Object.isFrozen(snapshot[0])).toBe(true);
  });
});
