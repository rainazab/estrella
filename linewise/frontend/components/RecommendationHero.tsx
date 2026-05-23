"use client";
import { motion } from "framer-motion";
import type { SimulationSummary } from "../lib/types";
import MetricCard from "./MetricCard";

type Props = {
  summary: SimulationSummary;
  onExplain: () => void;
};

export default function RecommendationHero({ summary, onExplain }: Props) {
  const oee = Math.round(summary.best_predicted_oee * 100);
  const naive = Math.round(summary.naive_predicted_oee * 100);
  const gain = Math.round(summary.estimated_oee_gain * 100);
  const conf = Math.round(summary.evidence_strength * 100);

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.5 }}
      className="space-y-4"
    >
      <div className="card p-6 md:p-8 border border-damm-accent/30 shadow-glow">
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div>
            <div className="text-xs uppercase tracking-[0.2em] text-damm-accent">
              LineWise recommends
            </div>
            <div className="mt-2 text-3xl md:text-4xl font-semibold text-white">
              Line {summary.best_line}{" "}
              <span className="text-damm-accent">{summary.best_position}</span>
            </div>
            <div className="mt-2 text-damm-muted text-sm">
              Predicted to protect OEE best across canning lines 14, 17 and 19.
            </div>
          </div>
          <button onClick={onExplain} className="btn btn-ghost shrink-0">
            Why this?
          </button>
        </div>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
        <MetricCard
          label="Predicted OEE"
          value={`${oee}%`}
          sub={`Naive plan: ${naive}%`}
          tone="accent"
          delay={0.05}
        />
        <MetricCard
          label="OEE Gain vs Naive"
          value={`${gain >= 0 ? "+" : ""}${gain} pts`}
          sub={gain > 0 ? "Better than just appending" : "Comparable"}
          tone={gain > 0 ? "good" : gain < 0 ? "warn" : "default"}
          delay={0.1}
        />
        <MetricCard
          label="Downtime Avoided"
          value={`${Math.max(0, Math.round(summary.downtime_avoided_minutes))} min`}
          sub="vs naive insertion"
          tone="good"
          delay={0.15}
        />
        <MetricCard
          label="Evidence Strength"
          value={summary.evidence_strength_label}
          sub={`${conf}% confidence`}
          tone={conf >= 70 ? "good" : conf >= 55 ? "warn" : "bad"}
          delay={0.2}
        />
        <MetricCard
          label="Best Slot"
          value={summary.best_position.replace("After ", "")}
          sub={`Line ${summary.best_line}`}
          tone="accent"
          delay={0.25}
        />
      </div>
    </motion.div>
  );
}
