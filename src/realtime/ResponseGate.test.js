import { describe, expect, it } from "vitest";

import { ResponseGate } from "./ResponseGate.js";

describe("ResponseGate", () => {
  it("accepts only the active response", () => {
    const gate = new ResponseGate();
    gate.begin("response-1");
    expect(gate.accepts("response-1")).toBe(true);
    expect(gate.accepts("response-2")).toBe(false);
  });

  it("rejects late deltas after interruption", () => {
    const gate = new ResponseGate();
    gate.begin("response-1");
    gate.invalidateCurrent();
    expect(gate.accepts("response-1")).toBe(false);
    expect(gate.accepts(null)).toBe(false);
    gate.begin("response-2");
    expect(gate.accepts("response-1")).toBe(false);
    expect(gate.accepts("response-2")).toBe(true);
  });

  it("does not reopen an invalidated epoch without an explicit begin", () => {
    const gate = new ResponseGate();
    gate.begin(null);
    gate.invalidateCurrent();
    expect(gate.currentResponseId).toBeNull();
    expect(gate.accepts(null)).toBe(false);
  });

  it("adopts an upstream id for a locally opened response", () => {
    const gate = new ResponseGate();
    gate.begin(null);
    expect(gate.adopt("response-1")).toBe(true);
    expect(gate.currentResponseId).toBe("response-1");
    expect(gate.accepts("response-1")).toBe(true);
  });

  it("rejects deltas after a response completes", () => {
    const gate = new ResponseGate();
    gate.begin("response-1");
    gate.completeCurrent();
    expect(gate.accepts("response-1")).toBe(false);
    expect(gate.currentResponseId).toBeNull();
  });

  it("resolves known response id locations", () => {
    const gate = new ResponseGate();
    expect(gate.resolveId({ response_id: "a" })).toBe("a");
    expect(gate.resolveId({ response: { id: "b" } })).toBe("b");
    expect(gate.resolveId({ item: { response_id: "c" } })).toBe("c");
  });
});
