const DEFAULT_ORIGINS = ["http://localhost:5173", "http://127.0.0.1:5173"];

export const MODEL = "qwen-audio-3.0-realtime-plus";
export const BAILIAN_URL =
  `wss://llm-vdcmboq80tbpljv5.cn-beijing.maas.aliyuncs.com/api-ws/v1/realtime?model=${MODEL}`;

export const ALLOWED_VOICES = new Set([
  "longanqian",
  "longanlingxin",
  "longanlingxi",
  "longanxiaoxin",
  "longanlufeng",
]);
export const MAX_CLIENT_MESSAGE_BYTES = 512 * 1024;

export function loadConfig(env = process.env) {
  return {
    apiKey: env.DASHSCOPE_API_KEY?.trim() ?? "",
    port: Number.parseInt(env.PORT ?? "5173", 10),
    allowedOrigins: new Set(
      (env.ALLOWED_ORIGINS?.split(",") ?? DEFAULT_ORIGINS)
        .map((origin) => origin.trim())
        .filter(Boolean),
    ),
  };
}

export function resolveVoice(rawVoice) {
  return ALLOWED_VOICES.has(rawVoice) ? rawVoice : "longanqian";
}
