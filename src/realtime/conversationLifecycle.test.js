import { describe, expect, it, vi } from "vitest";

import { mountConversationLifecycle } from "./conversationLifecycle.js";

describe("conversation lifecycle", () => {
  it("reopens the start gate after a StrictMode cleanup and remount", () => {
    const endingRef = { current: false };
    const releaseResources = vi.fn();

    const firstCleanup = mountConversationLifecycle(endingRef, releaseResources);
    expect(endingRef.current).toBe(false);

    firstCleanup();
    expect(endingRef.current).toBe(true);
    expect(releaseResources).toHaveBeenCalledTimes(1);

    const secondCleanup = mountConversationLifecycle(endingRef, releaseResources);
    expect(endingRef.current).toBe(false);

    secondCleanup();
    expect(releaseResources).toHaveBeenCalledTimes(2);
  });
});
