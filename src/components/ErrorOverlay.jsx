import { RefreshCw, Unplug } from "lucide-react";

export function ErrorOverlay({ phase, detail, onReconnect }) {
  if (phase !== "disconnected") return null;

  return (
    <div className="state-overlay state-overlay--error" role="alert">
      <div className="error-core" aria-hidden="true"><Unplug size={24} /></div>
      <span className="section-kicker">CONNECTION PAUSED</span>
      <h2>声音链路未连接。</h2>
      <p>{detail}</p>
      <button className="primary-button" type="button" onClick={onReconnect}>
        <RefreshCw size={17} />
        重新连接
      </button>
    </div>
  );
}
