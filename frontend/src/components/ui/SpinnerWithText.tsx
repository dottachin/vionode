/* eslint-disable @typescript-eslint/no-explicit-any */

type Props = {
  label?: string;
  /** 0..100; if omitted => indeterminate spinner */
  progressPct?: number;
  /** seconds elapsed */
  elapsedSec?: number;
  /** seconds expected (estimation) */
  expectedSec?: number;
  /** e.g. "fast" | "balanced" | "optimal" */
  mode?: string | null;
  /** show "finalisation…" hint */
  finalizing?: boolean;
  /** size in px for the spinner circle */
  size?: number;
};

function toMMSS(totalSec: number | undefined) {
  if (typeof totalSec !== "number" || !Number.isFinite(totalSec)) return "00:00";
  const s = Math.max(0, Math.floor(totalSec));
  const mm = String(Math.floor(s / 60)).padStart(2, "0");
  const ss = String(s % 60).padStart(2, "0");
  return `${mm}:${ss}`;
}

export default function SpinnerWithText({
  label = "Chargement…",
  progressPct,
  elapsedSec = 0,
  expectedSec,
  mode,
  finalizing = false,
  size = 48,
}: Props) {
  const stroke = 5;
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;

  const pct = Math.max(0, Math.min(100, typeof progressPct === "number" ? progressPct : 0));
  const dash = (pct / 100) * c;
  const dashArray = `${dash} ${c - dash}`;

  const isDeterminate = typeof progressPct === "number";
  const showPctInside = isDeterminate;

  return (
    <div className="flex items-center gap-3">
      <div className="relative" style={{ width: size, height: size }}>
        {/* Track */}
        <svg
          width={size}
          height={size}
          viewBox={`0 0 ${size} ${size}`}
          className={isDeterminate ? "" : "animate-spin"}
          style={{ transformOrigin: "50% 50%" }}
        >
          <circle
            cx={size / 2}
            cy={size / 2}
            r={r}
            strokeWidth={stroke}
            className="text-muted"
            stroke="currentColor"
            fill="none"
            opacity={0.25}
          />
          {/* Progress (rotate to start at top) */}
          <g transform={`rotate(-90 ${size / 2} ${size / 2})`}>
            <circle
              cx={size / 2}
              cy={size / 2}
              r={r}
              strokeWidth={stroke}
              className="text-primary"
              stroke="currentColor"
              fill="none"
              strokeLinecap="round"
              strokeDasharray={isDeterminate ? dashArray : undefined}
            />
          </g>
        </svg>

        {/* Percentage badge inside spinner */}
        {showPctInside && (
          <div className="absolute inset-0 grid place-items-center text-[11px] font-medium">
            {Math.round(pct)}%
          </div>
        )}
      </div>

      <div className="min-w-0">
        <div className="font-medium">{label}</div>
        <div className="text-xs text-muted-foreground">
          {mode ? <>Mode&nbsp;<b>{mode}</b></> : null}
          {expectedSec != null && (
            <>
              {mode ? " · " : ""}
              {toMMSS(elapsedSec)} / ~{toMMSS(expectedSec)}
            </>
          )}
          {finalizing && " · finalisation…"}
        </div>
      </div>
    </div>
  );
}
