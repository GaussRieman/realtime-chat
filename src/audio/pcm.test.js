import { describe, expect, it } from "vitest";

import {
  float32ToPcm16,
  pcm16ToFloat32,
  resampleLinear,
  rms,
} from "./pcm.js";

describe("PCM conversion", () => {
  it("clamps float samples to signed PCM16", () => {
    expect(Array.from(float32ToPcm16(new Float32Array([-2, -1, 0, 1, 2])))).toEqual([
      -32768,
      -32768,
      0,
      32767,
      32767,
    ]);
  });

  it("round-trips representative PCM samples", () => {
    const input = new Int16Array([-32768, -8192, 0, 8192, 32767]);
    const output = float32ToPcm16(pcm16ToFloat32(input));
    output.forEach((sample, index) => {
      expect(Math.abs(sample - input[index])).toBeLessThanOrEqual(1);
    });
  });

  it("resamples 48 kHz and 44.1 kHz frames to 16 kHz", () => {
    expect(resampleLinear(new Float32Array(4800), 48_000, 16_000)).toHaveLength(1600);
    expect(resampleLinear(new Float32Array(4410), 44_100, 16_000)).toHaveLength(1600);
  });

  it("calculates RMS audio level", () => {
    expect(rms(new Float32Array([1, -1, 1, -1]))).toBe(1);
    expect(rms(new Float32Array())).toBe(0);
  });
});
