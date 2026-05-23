"use client";
import { motion } from "framer-motion";
import clsx from "clsx";
import type { TransitionRankRow } from "../lib/types";

type Props = {
  rows: TransitionRankRow[];
  selectedType?: string | null;
  onSelect: (transitionType: string) => void;
};

function fmtPct(v: number | null | undefined): string {
  if (v == null || isNaN(v)) return "—";
  return `${Math.round(v * 100)}%`;
}
function fmtCost(v: number | null | undefined): string {
  if (v == null || isNaN(v)) return "—";
  const s = v >= 0 ? "+" : "";
  return `${s}${v.toFixed(1)} pts`;
}
function fmtMin(v: number | null | undefined): string {
  if (v == null || isNaN(v)) return "—";
  return `${Math.round(v)} min`;
}

export default function TransitionRankTable({ rows, selectedType, onSelect }: Props) {
  return (
    <div className="card overflow-hidden">
      <div className="px-6 py-4 border-b border-white/5 flex items-center justify-between">
        <div className="text-sm font-semibold text-white">
          Transition types ranked by historical OEE cost
        </div>
        <div className="text-xs text-damm-muted">
          Lower (more negative) OEE cost = bigger historical damage
        </div>
      </div>
      <div className="overflow-x-auto scrollbar-thin">
        <table className="w-full text-sm">
          <thead className="text-left text-damm-muted text-xs uppercase tracking-wider">
            <tr>
              <th className="px-6 py-3">Rank</th>
              <th className="px-3 py-3">Transition</th>
              <th className="px-3 py-3 text-right">Cases</th>
              <th className="px-3 py-3 text-right">Avg OEE</th>
              <th className="px-3 py-3 text-right">OEE Cost</th>
              <th className="px-3 py-3 text-right">Avg Overrun</th>
              <th className="px-3 py-3">Risk Pattern</th>
              <th className="px-3 py-3">Worst Line</th>
              <th className="px-6 py-3" />
            </tr>
          </thead>
          <tbody>
            {rows.map((r, idx) => {
              const isSel = selectedType === r.transition_type;
              const cost = r.oee_cost_points ?? 0;
              const costClass = cost < -2 ? "text-damm-bad" : cost < 0 ? "text-damm-warn" : "text-damm-ok";
              return (
                <motion.tr
                  key={r.transition_type}
                  initial={{ opacity: 0, y: 4 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: idx * 0.02 }}
                  onClick={() => onSelect(r.transition_type)}
                  className={clsx(
                    "border-t border-white/5 hover:bg-white/[0.03] cursor-pointer transition",
                    isSel && "bg-damm-accent/[0.06]",
                  )}
                >
                  <td className="px-6 py-3 font-mono text-damm-muted">#{idx + 1}</td>
                  <td className="px-3 py-3 text-white">{r.transition_type}</td>
                  <td className="px-3 py-3 text-right font-mono text-damm-muted">{r.cases}</td>
                  <td className="px-3 py-3 text-right font-mono text-white">{fmtPct(r.avg_oee)}</td>
                  <td className={clsx("px-3 py-3 text-right font-mono", costClass)}>
                    {fmtCost(r.oee_cost_points)}
                  </td>
                  <td className="px-3 py-3 text-right font-mono text-damm-muted">{fmtMin(r.avg_overrun_minutes)}</td>
                  <td className="px-3 py-3 text-damm-ink">{r.risk_pattern}</td>
                  <td className="px-3 py-3 text-damm-ink">{r.worst_line ?? "—"}</td>
                  <td className="px-6 py-3 text-right">
                    <span className="text-damm-accent text-xs underline-offset-2 hover:underline">
                      Drill in →
                    </span>
                  </td>
                </motion.tr>
              );
            })}
            {rows.length === 0 && (
              <tr>
                <td colSpan={9} className="px-6 py-8 text-center text-damm-muted text-sm">
                  No transitions meet the filter.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
