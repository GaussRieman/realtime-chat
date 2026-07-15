export const INPUT_SAMPLE_RATE = 16_000;
export const OUTPUT_SAMPLE_RATE = 24_000;

export function resampleLinear(input, sourceRate, targetRate) {
  if (!(input instanceof Float32Array)) {
    throw new TypeError("input must be a Float32Array");
  }
  if (sourceRate <= 0 || targetRate <= 0) {
    throw new RangeError("sample rates must be positive");
  }
  if (input.length === 0) return new Float32Array();
  if (sourceRate === targetRate) return input.slice();

  const outputLength = Math.max(1, Math.round(input.length * targetRate / sourceRate));
  const output = new Float32Array(outputLength);
  const ratio = sourceRate / targetRate;

  for (let index = 0; index < outputLength; index += 1) {
    const sourceIndex = index * ratio;
    const left = Math.min(input.length - 1, Math.floor(sourceIndex));
    const right = Math.min(input.length - 1, left + 1);
    const mix = sourceIndex - left;
    output[index] = input[left] * (1 - mix) + input[right] * mix;
  }

  return output;
}

export function float32ToPcm16(input) {
  const output = new Int16Array(input.length);
  for (let index = 0; index < input.length; index += 1) {
    const sample = Math.max(-1, Math.min(1, input[index]));
    output[index] = sample < 0 ? sample * 0x8000 : sample * 0x7fff;
  }
  return output;
}

export function pcm16ToFloat32(input) {
  const source = input instanceof Int16Array ? input : new Int16Array(input);
  const output = new Float32Array(source.length);
  for (let index = 0; index < source.length; index += 1) {
    output[index] = source[index] / (source[index] < 0 ? 0x8000 : 0x7fff);
  }
  return output;
}

export function int16ToBase64(input) {
  const bytes = new Uint8Array(input.buffer, input.byteOffset, input.byteLength);
  let binary = "";
  for (let index = 0; index < bytes.length; index += 1) {
    binary += String.fromCharCode(bytes[index]);
  }
  return btoa(binary);
}

export function base64ToInt16(encoded) {
  const binary = atob(encoded);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return new Int16Array(bytes.buffer);
}

export function rms(input) {
  if (input.length === 0) return 0;
  let sum = 0;
  for (const sample of input) sum += sample * sample;
  return Math.sqrt(sum / input.length);
}
