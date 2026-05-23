"use client";
import { motion } from "framer-motion";
import clsx from "clsx";
import type { CandidateResult } from "../lib/types";

type Props = {
  ranked: CandidateResult[];
  onPick: (candidateId: string) => void;
  naiveAnchor?: string | null;
};

function verdictChip(v: CandidateResult["verdict"]) {
  if (v === "recommended") return <span className="chip chip-blue">Recommended</span>;
  if (v === "backup") return <span className="chip chip-warn">Backup</span>;
  if (v === "infeasible") return <span className="chip chip-bad">Infeasible</span>;
  return <span className="chip chip-bad">Avoid</span>;
}

function decisionChip(d?: string | null) {
  if (!d) return null;
  const tone: Record<string, string> = {
    ACCEPT: "chip chip-ok",
    ACCEPT_WITH_MOVE: "chip chip-blue",
    SPLIT: "chip chip-warn",
    DELAY: "chip chip-warn",
    ESCALATE: "chip chip-bad",
  };
  return <span className={tone[d] || "chip"}>{d.replace(/_/g, " ")}</span>;
}

export default function ScenarioTable({ ranked, onPick, naiveAnchor }: Props) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.5, delay: 0.1 }}
      className="card overflow-hidden"
    >
      <div className="px-6 py-4 border-b border-white/5 flex items-center justify-between">
        <div className="text-sm font-semibold text-white">Ranked candidate slots</div>
        <div className="text-xs text-damm-muted">Sorted by Sequence Pain Score (lower is better)</div>
      </div>
      <div className="overflow-x-auto scrollbar-thin">
        <table className="w-full text-sm">
          <thead className="text-left text-damm-muted text-xs uppercase tracking-wider">
            <tr>
              <th className="px-6 py-3">Rank</th>
              <th className="px-3 py-3">Line</th>
              <th className="px-3 py-3">Slot</th>
              <th className="px-3 py-3">Transition</th>
              <th className="px-3 py-3 text-right">OEE</th>
              <th className="px-3 py-3 text-right">vs Bench.</th>
              <th className="px-3 py-3 text-right">HL</th>
              <th className="px-3 py-3 text-right">€ vs Naive</th>
              <th className="px-3 py-3">Cleaning</th>
              <th className="px-3 py-3">Decision</th>
              <th className="px-6 py-3" />
            </tr>
          </thead>
          <tbody>
            {ranked.map((c) => {
              const isNaive = c.anchor_of === naiveAnchor;
              const bench = c.historical_benchmark?.line_transition_benchmark_oee;
              const benchDelta = bench != null ? (c.predicted_oee - bench) * 100 : null;
              const hl = c.business_impact?.hl_protected ?? 0;
              const eur = c.business_impact?.financial_delta_eur ?? 0;
              const cleaning = c.cleaning_impact?.cleaning_risk ?? "unknown";
              return (
                <tr
                  key={c.candidate_id}
                  className={clsx(
                    "border-t border-white/5 hover:bg-white/[0.03] cursor-pointer transition",
                    c.verdict === "recommended" && "bg-damm-accent/[0.04]",
                  )}
                  onClick={() => onPick(c.candidate_id)}
                >
                  <td className="px-6 py-3 font-mono text-damm-muted">{c.rank ? `#${c.rank}` : "—"}</td>
                  <td className="px-3 py-3 font-semibold text-white">{c.line}</td>
                  <td className="px-3 py-3 text-damm-ink">
                    {c.position_label}
                    {isNaive ? <span className="ml-2 chip chip-bad">naive</span> : null}
                  </td>
                  <td className="px-3 py-3 text-damm-ink">
                    <div>{c.transition_type ?? "—"}</div>
                    {c.diagnostic_risk_pattern ? (
                      <div className="text-[10px] text-damm-muted">{c.diagnostic_risk_pattern}</div>
                    ) : null}
                  </td>
                  <td className="px-3 py-3 text-right font-mono text-white">
                    {Math.round(c.predicted_oee * 100)}%
                  </td>
                  <td
                    className={clsx(
                      "px-3 py-3 text-right font-mono",
                      benchDelta == null
                        ? "text-damm-muted"
                        : benchDelta > 0
                        ? "text-damm-ok"
                        : benchDelta < -3
                        ? "text-damm-bad"
                        : "text-damm-warn",
                    )}
                  >
                    {benchDelta != null ? `${benchDelta >= 0 ? "+" : ""}${benchDelta.toFixed(0)} pts` : "—"}
                  </td>
                  <td className="px-3 py-3 text-right font-mono text-damm-muted">{hl.toFixed(0)}</td>
                  <td
                    className={clsx(
                      "px-3 py-3 text-right font-mono",
                      eur > 0 ? "text-damm-ok" : eur < 0 ? "text-damm-bad" : "text-damm-muted",
                    )}
                  >
                    €{Math.round(eur).toLocaleString()}
                  </td>
                  <td className="px-3 py-3">
                    <span
                      className={clsx(
                        "chip",
                        cleaning === "low" && "chip-ok",
                        cleaning === "medium" && "chip-warn",
                        cleaning === "high" && "chip-bad",
                        cleaning === "unknown" && "chip-blue",
                      )}
                    >
                      {cleaning}
                    </span>
                  </td>
                  <td className="px-3 py-3">{decisionChip(c.decision) || verdictChip(c.verdict)}</td>
                  <td className="px-6 py-3 text-right">
                    <span className="text-damm-accent text-xs underline-offset-2 hover:underline">
                      Explain →
                    </span>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </motion.div>
  );
}
