"use client";
import type { CandidateResult } from "../lib/types";

type Props = {
  infeasible: CandidateResult[];
};

export default function InfeasiblePanel({ infeasible }: Props) {
  if (!infeasible || infeasible.length === 0) return null;
  // Collapse by line — show one row per blocked line
  const byLine = new Map<number, CandidateResult>();
  for (const c of infeasible) {
    if (!byLine.has(c.line)) byLine.set(c.line, c);
  }
  const rows = Array.from(byLine.values()).sort((a, b) => a.line - b.line);

  return (
    <div className="card p-5 border border-damm-bad/30">
      <div className="text-xs uppercase tracking-[0.2em] text-damm-bad mb-2">
        Not feasible
      </div>
      <div className="text-xs text-damm-muted mb-3">
        These lines were considered but rejected by the hard line-format rule.
        Shown for transparency, not as alternatives.
      </div>
      <ul className="space-y-2">
        {rows.map((c) => (
          <li
            key={c.line}
            className="flex items-start gap-3 rounded-xl border border-damm-bad/30 bg-damm-bad/5 px-3 py-2"
          >
            <span className="chip chip-bad">Line {c.line}</span>
            <span className="text-sm text-damm-ink/90">
              {c.infeasibility_reason ?? "Line cannot run this format."}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
