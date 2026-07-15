import { Mic, Radio } from "lucide-react";

export function StartOverlay({ phase, onStart, detail }) {
  if (!["idle", "ended"].includes(phase)) return null;

  return (
    <div className="state-overlay state-overlay--start">
      <div className="start-core" aria-hidden="true">
        <span className="start-core__orbit" />
        <Mic size={24} />
      </div>
      <span className="section-kicker">READY TO CONNECT</span>
      <h2>{phase === "ended" ? "再来一段对话？" : "让对话自然发生。"}</h2>
      <p>{detail}</p>
      <button className="primary-button" type="button" onClick={onStart}>
        <Radio size={17} />
        开始实时对话
      </button>
      <span className="privacy-note">麦克风音频仅用于本次实时会话</span>
    </div>
  );
}
