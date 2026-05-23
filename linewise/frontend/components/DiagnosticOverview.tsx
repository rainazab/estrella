"use client";
import { motion } from "framer-motion";
import MetricCard from "./MetricCard";
import type { DiagnosticSummary, TransitionRankRow } from "../lib/types";

type Props = {
  summary: DiagnosticSummary | null;
  rows: TransitionRankRow[];
};

export default function DiagnosticOverview({ summary, rows }: Props) {
  const worst = summary?.worst_oee_trap ?? "—";
  const cost = summary?.total_estimated_oee_cost;
  const orders = summary?.orders_analyzed ?? 0;
  const line = summary?.highest_risk_line ?? "—";

  const worstCases = rows.find((r) => r.transition_type === worst)?.cases ?? 0;

  return (
    <motion.div
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4 }}
      className="space-y-5"
    >
      <div>
        <div className="text-xs uppercase tracking-[0.2em] text-damm-muted">
          Step 1 · Build trust before the simulator
        </div>
        <h1 className="text-3xl md:text-4xl font-semibold text-white mt-1">
          Diagnostic Browse
        </h1>
        <p className="mt-2 text-damm-muted max-w-2xl">
          Find the historical transitions that quietly damaged OEE. LineWise
          ranks every transition type by historical OEE cost, then lets you
          drill into the real 2025 orders that prove it.
        </p>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <MetricCard
          label="Worst OEE Trap"
          value={worst}
          sub={worstCases ? `${worstCases} historical cases` : undefined}
          tone="bad"
        />
        <MetricCard
          label="Total Est. OEE Cost"
          value={cost != null ? `${cost.toFixed(0)} pts` : "—"}
          sub="Sum of OEE deviations vs. baseline"
          tone={cost != null && cost < 0 ? "warn" : "default"}
        />
        <MetricCard
          label="Orders Analyzed"
          value={String(orders)}
          sub="2025 production OFs"
          tone="default"
        />
        <MetricCard
          label="Highest-Risk Line"
          value={line === "—" ? "—" : `Line ${line}`}
          sub="Lowest historical avg OEE"
          tone="warn"
        />
      </div>
    </motion.div>
  );
}
