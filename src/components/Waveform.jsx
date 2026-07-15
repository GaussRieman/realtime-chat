import { useMemo } from "react";

const SHAPE = [
  0.22, 0.38, 0.55, 0.31, 0.74, 0.46, 0.9, 0.42, 0.66, 0.95,
  0.49, 0.78, 0.35, 0.61, 0.86, 0.44, 0.7, 0.3, 0.81, 0.53,
  0.98, 0.4, 0.64, 0.27, 0.76, 0.51, 0.89, 0.33, 0.58, 0.24,
  0.68, 0.43, 0.82, 0.36, 0.71, 0.29, 0.62, 0.47, 0.92, 0.39,
];

export function Waveform({ phase, inputLevel, outputLevel }) {
  const activeLevel = phase === "speaking" ? outputLevel : inputLevel;
  const isActive = ["listening", "generating", "speaking", "interrupted"].includes(phase);
  const bars = useMemo(() => SHAPE.map((shape, index) => ({ shape, index })), []);

  return (
    <div
      className={`waveform waveform--${phase}`}
      role="img"
      aria-label={isActive ? `实时音频信号，强度 ${Math.round(activeLevel * 100)}%` : "音频信号静止"}
    >
      <div className="waveform__axis" />
      {bars.map(({ shape, index }) => {
        const height = isActive
          ? Math.max(4, (shape * 58) + (activeLevel * 52 * ((index % 4) + 1) / 4))
          : 2;
        return (
          <span
            className="waveform__bar"
            key={index}
            style={{
              "--bar-height": `${Math.min(100, height)}%`,
              "--bar-delay": `${-((index * 37) % 900)}ms`,
            }}
          />
        );
      })}
      {phase === "interrupted" && <span className="waveform__interrupt" aria-hidden="true" />}
    </div>
  );
}
