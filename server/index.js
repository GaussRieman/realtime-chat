import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

import express from "express";
import { WebSocket, WebSocketServer } from "ws";

import { analysisJsonErrorHandler, createAnalysisHandler } from "./analysisRoute.js";
import {
  ANALYSIS_MODEL,
  BAILIAN_URL,
  loadConfig,
  MAX_ANALYSIS_BODY_BYTES,
  resolveVoice,
} from "./config.js";
import {
  clientError,
  parseClientMessage,
  safeUpstreamError,
  sessionUpdate,
} from "./protocol.js";

loadEnvFile();

const config = loadConfig();
const app = express();
const server = http.createServer(app);
const realtimeServer = new WebSocketServer({ noServer: true, maxPayload: 512 * 1024 });
const isProduction = process.env.NODE_ENV === "production";

app.disable("x-powered-by");
app.get("/api/health", (_request, response) => {
  response.json({
    ok: true,
    realtimeConfigured: Boolean(config.apiKey),
    analysisConfigured: Boolean(config.apiKey),
    model: "qwen-audio-3.0-realtime-plus",
    analysisModel: ANALYSIS_MODEL,
  });
});

app.post(
  "/api/conversation-analysis",
  express.json({ limit: MAX_ANALYSIS_BODY_BYTES }),
  createAnalysisHandler({ config }),
);
app.use("/api/conversation-analysis", analysisJsonErrorHandler);

if (isProduction) {
  const distPath = path.resolve(process.cwd(), "dist");
  app.use(express.static(distPath));
  app.use((request, response, next) => {
    if (request.method !== "GET" || request.path.startsWith("/api/")) {
      next();
      return;
    }
    response.sendFile(path.join(distPath, "index.html"));
  });
} else {
  const { createServer: createViteServer } = await import("vite");
  const vite = await createViteServer({
    server: { middlewareMode: true },
    appType: "spa",
  });
  app.use(vite.middlewares);
}

server.on("upgrade", (request, socket, head) => {
  let url;
  try {
    url = new URL(request.url, `http://${request.headers.host}`);
  } catch {
    socket.destroy();
    return;
  }

  if (url.pathname !== "/realtime") {
    socket.destroy();
    return;
  }

  const origin = request.headers.origin;
  if (!origin || !config.allowedOrigins.has(origin)) {
    socket.write("HTTP/1.1 403 Forbidden\r\n\r\n");
    socket.destroy();
    return;
  }

  request.realtimeVoice = resolveVoice(url.searchParams.get("voice"));
  realtimeServer.handleUpgrade(request, socket, head, (client) => {
    realtimeServer.emit("connection", client, request);
  });
});

realtimeServer.on("connection", (client, request) => {
  const connectionId = crypto.randomUUID().slice(0, 8);
  let upstream;
  let closed = false;
  let sessionUpdateSent = false;
  let sessionReady = false;
  let sessionTimer;

  const sendSessionUpdate = () => {
    if (sessionUpdateSent || upstream?.readyState !== WebSocket.OPEN) return;
    sessionUpdateSent = true;
    upstream.send(JSON.stringify(sessionUpdate(request.realtimeVoice)));
  };

  const closeBoth = (code = 1000, reason = "session ended") => {
    if (closed) return;
    closed = true;
    clearTimeout(sessionTimer);
    if (client.readyState === WebSocket.OPEN) client.close(code, reason);
    if (upstream?.readyState === WebSocket.OPEN) upstream.close(code, reason);
  };

  if (!config.apiKey) {
    client.send(
      clientError(
        "SERVICE_NOT_CONFIGURED",
        "服务端尚未配置 DASHSCOPE_API_KEY",
        false,
      ),
    );
    client.close(1011, "service not configured");
    return;
  }

  upstream = new WebSocket(BAILIAN_URL, {
    headers: { Authorization: `Bearer ${config.apiKey}` },
  });

  upstream.on("open", () => {
    console.info(`[realtime:${connectionId}] upstream connected`);
    sessionTimer = setTimeout(() => {
      if (!sessionReady && client.readyState === WebSocket.OPEN) {
        client.send(clientError("SESSION_INIT_TIMEOUT", "实时语音会话初始化超时", false));
        closeBoth(1011, "session initialization timed out");
      }
    }, 10_000);
  });

  client.on("message", (raw) => {
    const parsed = parseClientMessage(raw);
    if (!parsed.ok) {
      client.send(clientError(parsed.code, parsed.message));
      return;
    }

    if (parsed.kind === "ping") {
      client.send(JSON.stringify({ type: "client.pong", sentAt: parsed.event.sentAt }));
      return;
    }

    if (!sessionReady || upstream.readyState !== WebSocket.OPEN) {
      client.send(clientError("UPSTREAM_NOT_READY", "实时语音链路尚未就绪"));
      return;
    }

    upstream.send(JSON.stringify(parsed.event));
  });

  upstream.on("message", (raw) => {
    if (client.readyState !== WebSocket.OPEN) return;

    let event;
    try {
      event = JSON.parse(raw.toString());
    } catch {
      client.send(safeUpstreamError(raw));
      return;
    }

    if (event.type === "session.created") {
      sendSessionUpdate();
    }

    if (event.type === "session.updated" && !sessionReady) {
      sessionReady = true;
      clearTimeout(sessionTimer);
      client.send(JSON.stringify({ type: "proxy.ready", connectionId }));
    }

    if (process.env.DEBUG_UPSTREAM_EVENTS) {
      const verbose = [
        "conversation.item.input_audio_transcription.completed",
        "conversation.item.input_audio_transcription.failed",
        "error",
      ].includes(event.type);
      console.info(`[realtime:${connectionId}] upstream event: ${event.type}`, verbose ? JSON.stringify(event) : "");
    }

    client.send(safeUpstreamError(raw));
  });

  upstream.on("error", () => {
    if (client.readyState === WebSocket.OPEN) {
      client.send(clientError("UPSTREAM_CONNECTION_FAILED", "无法连接实时语音服务", false));
    }
  });

  upstream.on("close", (code) => {
    console.info(`[realtime:${connectionId}] upstream closed (${code})`);
    closeBoth(1011, "upstream disconnected");
  });

  client.on("close", () => closeBoth());
  client.on("error", () => closeBoth(1011, "client connection error"));
});

server.on("error", (error) => {
  if (error.code === "EADDRINUSE") {
    console.error(
      `Port ${config.port} is already in use. Audio Anything may already be running.`,
    );
    process.exitCode = 1;
    return;
  }
  throw error;
});

server.listen(config.port, "0.0.0.0", () => {
  console.info(`Audio Anything running at http://localhost:${config.port}`);
  if (!config.apiKey) {
    console.info("Realtime calls disabled until DASHSCOPE_API_KEY is configured.");
  }
});

function loadEnvFile() {
  const envPath = path.resolve(process.cwd(), ".env");
  if (!fs.existsSync(envPath)) return;

  const contents = fs.readFileSync(envPath, "utf8");
  for (const line of contents.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const separator = trimmed.indexOf("=");
    if (separator < 1) continue;
    const key = trimmed.slice(0, separator).trim();
    const value = trimmed.slice(separator + 1).trim();
    if (!(key in process.env)) process.env[key] = value;
  }
}
