"use client";

export type CockpitMode = "plan-review" | "rush-order" | "evidence";

type Props = {
  mode: CockpitMode;
  onChange: (m: CockpitMode) => void;
  status?: string;
};

const MODES: { key: CockpitMode; label: string; sub: string }[] = [
  { key: "plan-review", label: "Plan Review", sub: "Where the plan is about to slip" },
  { key: "rush-order", label: "Rush Order", sub: "Insert an urgent OF without losing OEE" },
  { key: "evidence", label: "Evidence", sub: "Why we trust each recommendation" },
];

export default function ModeToggle({ mode, onChange, status }: Props) {
  return (
    <div className="mode-row">
      <div className="mode-toggle" role="tablist">
        {MODES.map((m) => (
          <button
            key={m.key}
            role="tab"
            aria-selected={mode === m.key}
            className={`mode-btn ${mode === m.key ? "on" : ""}`}
            onClick={() => onChange(m.key)}
          >
            <span className="mb-label">{m.label}</span>
            <span className="mb-sub">{m.sub}</span>
          </button>
        ))}
      </div>
      {status ? <div className="mode-status">{status}</div> : null}
    </div>
  );
}
