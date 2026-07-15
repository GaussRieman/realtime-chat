import { useCallback, useEffect, useRef, useState } from "react";

import { AudioPlaybackQueue } from "../audio/AudioPlaybackQueue.js";
import { MicrophoneCapture } from "../audio/MicrophoneCapture.js";
import { int16ToBase64 } from "../audio/pcm.js";
import { RealtimeClient } from "../realtime/RealtimeClient.js";
import { ResponseGate } from "../realtime/ResponseGate.js";
import { classifyRealtimeError } from "../realtime/errors.js";
import {
  clearTranscripts,
  createTranscript,
  loadTranscripts,
  saveTranscripts,
  upsertTranscript,
} from "../realtime/transcripts.js";

const INITIAL_STATE = {
  phase: "idle",
  message: "准备开始",
  detail: "点击后允许麦克风访问，随后直接说话即可。",
};

const SYSTEM_MESSAGES = {
  SERVICE_NOT_CONFIGURED: "服务端尚未配置百炼 API Key。",
  UPSTREAM_CONNECTION_FAILED: "无法连接百炼实时语音服务。",
  UPSTREAM_NOT_READY: "语音链路仍在建立，请稍候。",
  PROXY_UNREACHABLE: "本地实时服务不可用。",
  PROXY_CLOSED: "实时语音链路已关闭。",
};

export function useRealtimeConversation() {
  const [sessionState, setSessionState] = useState(INITIAL_STATE);
  const [transcripts, setTranscripts] = useState(() => loadTranscripts());
  const [inputLevel, setInputLevel] = useState(0);
  const [outputLevel, setOutputLevel] = useState(0);
  const [muted, setMutedState] = useState(false);
  const [captionsVisible, setCaptionsVisible] = useState(true);
  const [voice, setVoice] = useState("longanqian");
  const [activeVoice, setActiveVoice] = useState(null);
  const [latency, setLatency] = useState(null);
  const [elapsedSeconds, setElapsedSeconds] = useState(0);

  const phaseRef = useRef("idle");
  const clientRef = useRef(null);
  const microphoneRef = useRef(null);
  const playbackRef = useRef(null);
  const audioContextRef = useRef(null);
  const gateRef = useRef(new ResponseGate());
  const transcriptRef = useRef(transcripts);
  const startedAtRef = useRef(null);
  const pingSamplesRef = useRef([]);
  const speakingFramesRef = useRef(0);
  const endingRef = useRef(false);
  const activeAssistantIdRef = useRef(null);
  const cleanupRef = useRef(() => Promise.resolve());

  const updateState = useCallback((phase, message, detail) => {
    phaseRef.current = phase;
    setSessionState({ phase, message, detail });
  }, []);

  const updateTranscripts = useCallback((updater) => {
    setTranscripts((current) => {
      const next = typeof updater === "function" ? updater(current) : updater;
      transcriptRef.current = next;
      saveTranscripts(next);
      return next;
    });
  }, []);

  const addSystemMessage = useCallback((text, status = "completed") => {
    updateTranscripts((items) => [
      ...items,
      createTranscript("system", text, { status }),
    ]);
  }, [updateTranscripts]);

  const interrupt = useCallback((source = "voice") => {
    if (phaseRef.current !== "speaking") return;

    const activeId = activeAssistantIdRef.current;
    gateRef.current.invalidateCurrent();
    playbackRef.current?.invalidate();
    if (source === "voice") clientRef.current?.send({ type: "response.cancel" });
    activeAssistantIdRef.current = null;

    if (activeId) {
      updateTranscripts((items) => items.map((item) => {
        if (item.id !== activeId) return item;
        const text = item.text.endsWith("…") ? item.text : `${item.text}…`;
        return { ...item, text, status: "interrupted", completedAt: Date.now() };
      }));
    }

    addSystemMessage(source === "server"
      ? "检测到你的声音，AI 回答已停止"
      : "你已插话，AI 回答已停止");
    updateState("interrupted", "已停止回答，正在听你说", "继续说即可，系统会自动判断停顿。");
  }, [addSystemMessage, updateState, updateTranscripts]);

  const handleEvent = useCallback((event) => {
    const type = event.type;

    if (type === "client.pong") {
      const sample = Math.max(0, Date.now() - event.sentAt);
      const samples = [...pingSamplesRef.current, sample].slice(-5).sort((a, b) => a - b);
      pingSamplesRef.current = samples;
      setLatency(samples[Math.floor(samples.length / 2)]);
      return;
    }

    if (type === "proxy.error" || type === "error") {
      const classified = classifyRealtimeError(event);
      if (classified.action === "ignore") return;
      const message = SYSTEM_MESSAGES[classified.code] ?? classified.message;
      addSystemMessage(message, "error");
      if (classified.action === "disconnect") {
        updateState("disconnected", "声音链路已中断", message);
        void cleanupRef.current();
      }
      return;
    }

    if (type === "input_audio_buffer.speech_started") {
      interrupt("server");
      updateState("listening", "正在听你说", "说完后自然停顿，我会自动回应。");
      return;
    }

    if (type === "input_audio_buffer.speech_stopped") {
      updateState("generating", "正在组织回应", "语音已经收到，答案马上抵达。" );
      return;
    }

    if (type === "response.created") {
      const responseId = gateRef.current.resolveId(event) ?? event.response?.id;
      gateRef.current.begin(responseId);
      return;
    }

    if (type === "response.audio.delta") {
      const responseId = gateRef.current.resolveId(event);
      if (!gateRef.current.currentResponseId) return;
      gateRef.current.adopt(responseId);
      if (responseId && !gateRef.current.accepts(responseId)) return;

      playbackRef.current?.enqueueBase64(event.delta, playbackRef.current.epoch);
      updateState("speaking", "AI 正在回应", "随时开口即可打断，系统会立即切回聆听。" );
      return;
    }

    if (type === "conversation.item.input_audio_transcription.completed") {
      const text = event.transcript?.trim();
      if (!text) return;
      updateTranscripts((items) => [
        ...items,
        createTranscript("user", text, { id: event.item_id ?? undefined }),
      ]);
      return;
    }

    if (type === "response.audio_transcript.delta") {
      const responseId = gateRef.current.resolveId(event);
      if (!gateRef.current.currentResponseId) return;
      gateRef.current.adopt(responseId);
      if (responseId && !gateRef.current.accepts(responseId)) return;
      const id = event.item_id ?? activeAssistantIdRef.current ?? `assistant-${gateRef.current.epoch}`;
      activeAssistantIdRef.current = id;
      updateTranscripts((items) => {
        const existing = items.find((item) => item.id === id);
        return upsertTranscript(items, createTranscript("assistant", `${existing?.text ?? ""}${event.delta ?? ""}`, {
          id,
          status: "streaming",
          startedAt: existing?.startedAt,
        }));
      });
      return;
    }

    if (type === "response.audio_transcript.done") {
      const responseId = gateRef.current.resolveId(event);
      if (!gateRef.current.currentResponseId) return;
      gateRef.current.adopt(responseId);
      if (responseId && !gateRef.current.accepts(responseId)) return;
      const text = event.transcript?.trim();
      if (!text) return;
      const id = event.item_id ?? activeAssistantIdRef.current ?? `assistant-${gateRef.current.epoch}`;
      activeAssistantIdRef.current = id;
      updateTranscripts((items) => upsertTranscript(items, createTranscript("assistant", text, { id })));
      return;
    }

    if (type === "response.done") {
      gateRef.current.completeCurrent();
      activeAssistantIdRef.current = null;
      if (phaseRef.current === "speaking") {
        updateState("listening", "继续说，我在听", "无需点击按钮，直接开始下一句话。" );
      }
    }
  }, [addSystemMessage, interrupt, updateState, updateTranscripts]);

  const cleanup = useCallback(async () => {
    const client = clientRef.current;
    const microphone = microphoneRef.current;
    const playback = playbackRef.current;
    const audioContext = audioContextRef.current;
    clientRef.current = null;
    microphoneRef.current = null;
    playbackRef.current = null;
    audioContextRef.current = null;
    client?.close();
    await Promise.allSettled([microphone?.stop(), playback?.close()]);
    if (audioContext && audioContext.state !== "closed") await audioContext.close();
    setInputLevel(0);
    setOutputLevel(0);
    setLatency(null);
  }, []);

  cleanupRef.current = cleanup;

  const start = useCallback(async () => {
    if (!["idle", "ended", "disconnected"].includes(phaseRef.current)) return;
    const isReconnect = phaseRef.current === "disconnected";
    const AudioContextConstructor = window.AudioContext ?? window.webkitAudioContext;
    if (!AudioContextConstructor) {
      updateState("disconnected", "未能开始对话", "当前浏览器不支持实时音频播放。" );
      return;
    }

    // Call resume before the first await so the browser associates audio playback with this click.
    const audioContext = new AudioContextConstructor({ latencyHint: "interactive" });
    const unlockAudio = audioContext.resume();
    endingRef.current = false;
    if (isReconnect) await cleanup();
    audioContextRef.current = audioContext;
    updateState("connecting", "正在建立声音链路", "请允许浏览器使用麦克风。" );
    setElapsedSeconds(0);
    pingSamplesRef.current = [];
    gateRef.current = new ResponseGate();

    if (!isReconnect) {
      clearTranscripts();
      updateTranscripts([]);
    }

    const playback = new AudioPlaybackQueue({ context: audioContext, onLevel: setOutputLevel });
    playbackRef.current = playback;
    const client = new RealtimeClient({ voice });
    clientRef.current = client;
    client.addEventListener("event", ({ detail }) => handleEvent(detail));
    client.addEventListener("disconnect", () => {
      if (!endingRef.current && !["connecting", "disconnected"].includes(phaseRef.current)) {
        updateState("disconnected", "声音链路已中断", "当前字幕已保留，重新连接将开启新的模型上下文。" );
        void cleanupRef.current();
      }
    });

    try {
      let health;
      try {
        const response = await fetch("/api/health", { headers: { Accept: "application/json" } });
        health = response.ok ? await response.json() : null;
      } catch {
        throw new Error("PROXY_UNREACHABLE");
      }
      if (!health?.realtimeConfigured) {
        const error = new Error("SERVICE_NOT_CONFIGURED");
        error.detail = "服务端尚未配置百炼 API Key。";
        throw error;
      }
      await unlockAudio;
      if (audioContext.state !== "running") await audioContext.resume();
      const microphone = new MicrophoneCapture({
        context: audioContext,
        onLevel: setInputLevel,
        onAudio: (pcm, level) => {
          if (phaseRef.current === "speaking") {
            speakingFramesRef.current = level > 0.035 ? speakingFramesRef.current + 1 : 0;
            if (speakingFramesRef.current >= 2) {
              speakingFramesRef.current = 0;
              interrupt("voice");
            }
          }
          client.send({ type: "input_audio_buffer.append", audio: int16ToBase64(pcm) });
        },
      });
      microphoneRef.current = microphone;
      await microphone.start();
      if (audioContext.state !== "running") await audioContext.resume();
      if (audioContext.state !== "running") throw new Error("AUDIO_CONTEXT_SUSPENDED");
      await playback.initialize();
      await client.connect();
      setActiveVoice(voice);
      startedAtRef.current = Date.now();
      updateState("listening", "正在听你说", "说完后自然停顿，我会自动回应。" );
      addSystemMessage("声音链路已建立，可以直接开始说话");
    } catch (error) {
      await cleanup();
      const denied = error?.name === "NotAllowedError";
      const unsupported = error?.message === "MICROPHONE_UNSUPPORTED";
      const detail = denied
        ? "麦克风权限被拒绝，请在浏览器设置中允许后重试。"
        : unsupported
          ? "当前浏览器不支持实时麦克风采集。"
          : error?.detail ?? SYSTEM_MESSAGES[error?.message] ?? "无法建立实时语音连接，请检查服务配置后重试。";
      updateState("disconnected", "未能开始对话", detail);
      addSystemMessage(detail, "error");
    }
  }, [addSystemMessage, cleanup, handleEvent, interrupt, updateState, updateTranscripts, voice]);

  const end = useCallback(async () => {
    endingRef.current = true;
    await cleanup();
    updateState("ended", "本次对话已结束", "字幕记录会保留到当前标签页关闭。" );
  }, [cleanup, updateState]);

  const setMuted = useCallback((nextMuted) => {
    microphoneRef.current?.setMuted(nextMuted);
    setMutedState(nextMuted);
  }, []);

  useEffect(() => {
    transcriptRef.current = transcripts;
  }, [transcripts]);

  useEffect(() => {
    if (!["listening", "generating", "speaking", "interrupted"].includes(sessionState.phase)) return undefined;
    const timer = window.setInterval(() => {
      if (startedAtRef.current) {
        setElapsedSeconds(Math.floor((Date.now() - startedAtRef.current) / 1000));
      }
    }, 1000);
    const ping = window.setInterval(() => {
      clientRef.current?.send({ type: "client.ping", sentAt: Date.now() });
    }, 3000);
    return () => {
      window.clearInterval(timer);
      window.clearInterval(ping);
    };
  }, [sessionState.phase]);

  useEffect(() => () => {
    endingRef.current = true;
    clientRef.current?.close();
    microphoneRef.current?.stop();
    playbackRef.current?.close();
    audioContextRef.current?.close();
  }, []);

  return {
    sessionState,
    transcripts,
    inputLevel,
    outputLevel,
    muted,
    captionsVisible,
    voice,
    activeVoice,
    latency,
    elapsedSeconds,
    start,
    end,
    setMuted,
    setCaptionsVisible,
    setVoice,
  };
}
