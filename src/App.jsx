import {
  Captions,
  CaptionsOff,
  Mic,
  MicOff,
  PhoneOff,
  Radio,
  Volume2,
} from "lucide-react";
import { useMemo } from "react";

import { ErrorOverlay } from "./components/ErrorOverlay.jsx";
import { StartOverlay } from "./components/StartOverlay.jsx";
import { TranscriptPanel } from "./components/TranscriptPanel.jsx";
import { Waveform } from "./components/Waveform.jsx";
import { useRealtimeConversation } from "./hooks/useRealtimeConversation.js";
import { VOICE_OPTIONS } from "./config/voices.js";

const ACTIVE_PHASES = new Set([
  "connecting",
  "listening",
  "generating",
  "speaking",
  "interrupted",
]);

function formatDuration(seconds) {
  const minutes = Math.floor(seconds / 60).toString().padStart(2, "0");
  const remainder = (seconds % 60).toString().padStart(2, "0");
  return `${minutes}:${remainder}`;
}

export default function App() {
  const conversation = useRealtimeConversation();
  const active = ACTIVE_PHASES.has(conversation.sessionState.phase);
  const elapsed = formatDuration(conversation.elapsedSeconds);
  const sessionId = useMemo(() => crypto.randomUUID().slice(0, 4).toUpperCase(), []);

  const connectionLabel = conversation.sessionState.phase === "disconnected"
    ? "链路中断"
    : conversation.latency != null
      ? `浏览器链路 · ${conversation.latency} ms`
      : active
        ? "实时链路 · 已连接"
        : "等待连接";

  return (
    <main className={`app app--${conversation.sessionState.phase}`}>
      <div className="ambient ambient--one" />
      <div className="ambient ambient--two" />

      <section className="console-shell" aria-label="Audio Anything 实时语音控制台">
        <header className="topbar">
          <div className="brand-lockup">
            <span className="brand-mark" aria-hidden="true">
              <i /><i />
            </span>
            <span className="brand-copy">
              <strong>AUDIO ANYTHING</strong>
              <small>REALTIME VOICE LAB</small>
            </span>
          </div>

          <div className="topbar__actions">
            <div className={`connection-state connection-state--${conversation.sessionState.phase}`}>
              <span className="connection-state__dot" />
              <span>{connectionLabel}</span>
            </div>
          </div>
        </header>

        <div className="console-grid">
          <section className="signal-stage" aria-labelledby="stage-title">
            <div className="stage-meta">
              <span>SESSION / {sessionId}</span>
              <span>QWEN AUDIO 3.0 · PLUS</span>
            </div>

            <div className="stage-center">
              <div className="stage-copy" aria-live="polite">
                <span className="section-kicker">
                  {conversation.sessionState.phase === "speaking"
                    ? "SYNTHESIS CHANNEL"
                    : conversation.sessionState.phase === "listening"
                      ? "VOICE INPUT ACTIVE"
                      : conversation.sessionState.phase === "generating"
                        ? "REASONING IN PROGRESS"
                        : "REALTIME SEMANTIC CHANNEL"}
                </span>
                <h1 id="stage-title">{conversation.sessionState.message}</h1>
                <p>{conversation.sessionState.detail}</p>
              </div>

              <Waveform
                phase={conversation.sessionState.phase}
                inputLevel={conversation.inputLevel}
                outputLevel={conversation.outputLevel}
              />
            </div>

            <div className="stage-footer">
              <div className="session-controls" aria-label="会话控制">
                <button
                  className={`round-button ${conversation.muted ? "round-button--active" : ""}`}
                  type="button"
                  disabled={!active}
                  onClick={() => conversation.setMuted(!conversation.muted)}
                  aria-label={conversation.muted ? "取消静音" : "静音麦克风"}
                  aria-pressed={conversation.muted}
                >
                  {conversation.muted ? <MicOff size={18} /> : <Mic size={18} />}
                </button>
                <button
                  className="round-button round-button--end"
                  type="button"
                  disabled={!active}
                  onClick={conversation.end}
                  aria-label="结束实时对话"
                >
                  <PhoneOff size={18} />
                </button>
                <button
                  className={`pill-button ${conversation.captionsVisible ? "pill-button--active" : ""}`}
                  type="button"
                  onClick={() => conversation.setCaptionsVisible(!conversation.captionsVisible)}
                  aria-pressed={conversation.captionsVisible}
                >
                  {conversation.captionsVisible ? <Captions size={17} /> : <CaptionsOff size={17} />}
                  <strong>字幕</strong>
                  <span>{conversation.captionsVisible ? "开" : "关"}</span>
                </button>
                <label className="voice-select" htmlFor="voice-select">
                  <Volume2 size={17} />
                  <span>音色</span>
                  <select
                    id="voice-select"
                    value={conversation.voice}
                    onChange={(event) => conversation.setVoice(event.target.value)}
                    aria-describedby={active ? "voice-effective-note" : undefined}
                  >
                    {VOICE_OPTIONS.map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                </label>
                {active && conversation.voice !== conversation.activeVoice && (
                  <span className="voice-effective-note" id="voice-effective-note" role="status">
                    下次会话生效
                  </span>
                )}
              </div>

              <div className="signal-spec">
                <span><Radio size={13} /> 16 kHz IN</span>
                <i />
                <span>24 kHz OUT</span>
              </div>
            </div>

            <StartOverlay
              phase={conversation.sessionState.phase}
              detail={conversation.sessionState.detail}
              onStart={conversation.start}
            />
            <ErrorOverlay
              phase={conversation.sessionState.phase}
              detail={conversation.sessionState.detail}
              onReconnect={conversation.start}
            />
          </section>

          <TranscriptPanel
            transcripts={conversation.transcripts}
            visible={conversation.captionsVisible}
            elapsed={elapsed}
          />
        </div>
      </section>

      <footer className="page-footer">
        <span>QWEN AUDIO 3.0 REALTIME PLUS</span>
        <span>CHINA NORTH 2 · BEIJING</span>
      </footer>

    </main>
  );
}
