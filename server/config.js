const DEFAULT_ORIGINS = ["http://localhost:5173", "http://127.0.0.1:5173"];

export const MODEL = "qwen-audio-3.0-realtime-plus";
export const BAILIAN_URL =
  `wss://llm-vdcmboq80tbpljv5.cn-beijing.maas.aliyuncs.com/api-ws/v1/realtime?model=${MODEL}`;
export const ANALYSIS_MODEL = "qwen3.7-max";
export const ANALYSIS_URL =
  "https://llm-vdcmboq80tbpljv5.cn-beijing.maas.aliyuncs.com/compatible-mode/v1/chat/completions";

export const ALLOWED_VOICES = new Set([
  "longanqian",
  "longanlingxin",
  "longanlingxi",
  "longanxiaoxin",
  "longanlufeng",
]);
export const MAX_CLIENT_MESSAGE_BYTES = 512 * 1024;
export const MAX_ANALYSIS_BODY_BYTES = 512 * 1024;
export const MAX_CONVERSATION_BODY_BYTES = 1024 * 1024;
export const MAX_ANALYSIS_UPDATE_BODY_BYTES = 256 * 1024;

export function loadConfig(env = process.env) {
  return {
    apiKey: env.DASHSCOPE_API_KEY?.trim() ?? "",
    port: Number.parseInt(env.PORT ?? "5173", 10),
    databasePath: env.DATABASE_PATH?.trim() || "data/audio-anything.sqlite",
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
