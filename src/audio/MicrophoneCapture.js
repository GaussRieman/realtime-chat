import {
  float32ToPcm16,
  INPUT_SAMPLE_RATE,
  resampleLinear,
  rms,
} from "./pcm.js";

const CHUNK_DURATION_SECONDS = 0.1;

export class MicrophoneCapture {
  constructor({ context, onAudio, onLevel }) {
    if (!context) throw new Error("A shared AudioContext is required");
    this.context = context;
    this.onAudio = onAudio;
    this.onLevel = onLevel;
    this.muted = false;
    this.paused = false;
    this.pending = [];
    this.pendingLength = 0;
  }

  async start() {
    if (!navigator.mediaDevices?.getUserMedia || !this.context?.audioWorklet) {
      throw new Error("MICROPHONE_UNSUPPORTED");
    }

    this.stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        channelCount: 1,
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
      },
    });

    await this.context.resume();
    await this.context.audioWorklet.addModule("/audio-capture-worklet.js");

    this.source = this.context.createMediaStreamSource(this.stream);
    this.worklet = new AudioWorkletNode(this.context, "audio-capture-processor");
    this.silentGain = this.context.createGain();
    this.silentGain.gain.value = 0;
    this.source.connect(this.worklet);
    this.worklet.connect(this.silentGain).connect(this.context.destination);

    this.sourceChunkSize = Math.round(this.context.sampleRate * CHUNK_DURATION_SECONDS);
    this.worklet.port.onmessage = ({ data }) => this.handleSamples(data);
  }

  handleSamples(samples) {
    this.pending.push(samples);
    this.pendingLength += samples.length;
    if (this.pendingLength < this.sourceChunkSize) return;

    const merged = new Float32Array(this.pendingLength);
    let offset = 0;
    for (const chunk of this.pending) {
      merged.set(chunk, offset);
      offset += chunk.length;
    }

    const frame = merged.slice(0, this.sourceChunkSize);
    const remainder = merged.slice(this.sourceChunkSize);
    this.pending = remainder.length ? [remainder] : [];
    this.pendingLength = remainder.length;

    const level = rms(frame);
    this.onLevel?.(Math.min(1, level * 7));
    if (this.muted || this.paused) return;

    const resampled = resampleLinear(frame, this.context.sampleRate, INPUT_SAMPLE_RATE);
    this.onAudio?.(float32ToPcm16(resampled), level);
  }

  applyTrackState() {
    const enabled = !this.muted && !this.paused;
    for (const track of this.stream?.getAudioTracks() ?? []) track.enabled = enabled;
  }

  setMuted(muted) {
    this.muted = muted;
    this.applyTrackState();
  }

  // Stops upload and disables the track while keeping the user's mute preference intact,
  // so resume() can restore it exactly as it was before the pause.
  pause() {
    this.paused = true;
    this.applyTrackState();
  }

  resume() {
    this.paused = false;
    this.applyTrackState();
  }

  async stop() {
    this.worklet?.disconnect();
    this.source?.disconnect();
    this.silentGain?.disconnect();
    for (const track of this.stream?.getTracks() ?? []) track.stop();
    this.pending = [];
    this.pendingLength = 0;
  }
}
