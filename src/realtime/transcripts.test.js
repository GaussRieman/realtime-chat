import { describe, expect, it } from "vitest";

import { createTranscript, upsertTranscript } from "./transcripts.js";

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
});
