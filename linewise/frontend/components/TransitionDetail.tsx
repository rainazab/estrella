"use client";
import clsx from "clsx";
import { motion } from "framer-motion";
import type { TransitionDetailResponse } from "../lib/types";
import LineComparisonTable from "./LineComparisonTable";
import ActualVsTheoreticalChart from "./ActualVsTheoreticalChart";
import HistoricalOrdersTable from "./HistoricalOrdersTable";

type Props = {
  detail: TransitionDetailResponse;
  onPickOrder: (prev: string, cur: string) => void;
  onUseInSimulator: () => void;
};

function pct(v: number | null | undefined): string {
  if (v == null || isNaN(v)) return "—";
  return `${(v * 100).toFixed(1)}%`;
}
function pts(v: number | null | undefined): string {
  if (v == null || isNaN(v)) return "—";
  return `${v >= 0 ? "+" : ""}${v.toFixed(1)} pts`;
}
function min(v: number | null | undefined): string {
  if (v == null || isNaN(v)) return "—";
  return `${Math.round(v)} min`;
}

export default function TransitionDetail({ detail, onPickOrder, onUseInSimulator }: Props) {
  const s = detail.summary;
  return (
    <motion.div
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3 }}
      className="space-y-5"
    >
      <div className="card p-6 border border-damm-accent/30 shadow-glow">
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div>
            <div className="text-xs uppercase tracking-[0.2em] text-damm-accent">
              Selected transition
            </div>
            <div className="text-2xl md:text-3xl font-semibold text-white mt-1">
              {detail.transition_type}
            </div>
            <div className="text-xs text-damm-muted mt-1">
              Evidence: {s.confidence_label} ({s.cases} cases)
            </div>
          </div>
          <button onClick={onUseInSimulator} className="btn btn-primary">
            Use this insight in simulator →
          </button>
        </div>

        <div className="grid grid-cols-2 md:grid-cols-6 gap-3 mt-6">
          {[
            { l: "Cases Found", v: String(s.cases) },
            { l: "Avg OEE", v: pct(s.avg_oee) },
            { l: "Baseline OEE", v: pct(s.baseline_oee) },
            { l: "Avg OEE Cost", v: pts(s.oee_cost_points) },
            { l: "Avg Actual CO", v: min(s.avg_actual_changeover_minutes) },
            { l: "Avg Overrun", v: min(s.avg_overrun_minutes) },
          ].map((m, i) => (
            <div key={i} className="rounded-xl border border-white/5 bg-white/[0.02] p-3">
              <div className="text-[10px] uppercase tracking-wider text-damm-muted">{m.l}</div>
              <div className="text-base text-white mt-0.5 font-mono">{m.v}</div>
            </div>
          ))}
        </div>
      </div>

      <div className="card p-5">
        <div className="text-sm font-semibold text-white mb-2">Why this transition is risky</div>
        <ul className="space-y-1.5">
          {detail.why_risky.map((b, i) => (
            <li key={i} className="text-sm text-damm-ink/90 flex gap-2">
              <span className="text-damm-accent">›</span>
              <span>{b}</span>
            </li>
          ))}
        </ul>
      </div>

      <div className="grid lg:grid-cols-2 gap-5">
        <LineComparisonTable rows={detail.line_comparison} />
        <ActualVsTheoreticalChart orders={detail.worst_orders} />
      </div>

      <HistoricalOrdersTable orders={detail.worst_orders} onSelect={onPickOrder} />
    </motion.div>
  );
}
