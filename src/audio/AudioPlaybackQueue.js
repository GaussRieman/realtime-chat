import { base64ToInt16, OUTPUT_SAMPLE_RATE, pcm16ToFloat32, rms } from "./pcm.js";

export class AudioPlaybackQueue {
  constructor({ context, onLevel } = {}) {
    if (!context) throw new Error("A shared AudioContext is required");
    this.context = context;
    this.onLevel = onLevel;
    this.sources = new Set();
    this.nextStartTime = 0;
    this.epoch = 0;
  }

  async initialize() {
    if (this.context.state === "closed") throw new Error("AUDIO_CONTEXT_CLOSED");
    await this.context.resume();
  }

  enqueueBase64(encoded, epoch = this.epoch) {
    if (!this.context || epoch !== this.epoch) return false;

    const samples = pcm16ToFloat32(base64ToInt16(encoded));
    const buffer = this.context.createBuffer(1, samples.length, OUTPUT_SAMPLE_RATE);
    buffer.copyToChannel(samples, 0);

    const source = this.context.createBufferSource();
    source.buffer = buffer;
    source.connect(this.context.destination);

    const now = this.context.currentTime;
    const startAt = Math.max(now + 0.025, this.nextStartTime);
    this.nextStartTime = startAt + buffer.duration;
    this.sources.add(source);
    this.onLevel?.(Math.min(1, rms(samples) * 5));
    source.onended = () => {
      this.sources.delete(source);
      if (this.sources.size === 0) this.onLevel?.(0);
    };
    source.start(startAt);
    return true;
  }

  invalidate() {
    this.epoch += 1;
    for (const source of this.sources) {
      try {
        source.stop();
      } catch {
        // A source may already have ended between iteration and stop.
      }
    }
    this.sources.clear();
    this.nextStartTime = this.context?.currentTime ?? 0;
    this.onLevel?.(0);
    return this.epoch;
  }

  async close() {
    this.invalidate();
  }
}
