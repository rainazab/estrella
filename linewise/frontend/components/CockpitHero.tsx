"use client";
import { motion } from "framer-motion";
import clsx from "clsx";
import type { CandidateResult, SimulationSummary } from "../lib/types";

type Props = {
  summary: SimulationSummary;
  best: CandidateResult;
  onExplain: () => void;
  onAccept?: () => void;
  onOverride?: () => void;
  actionState?: "idle" | "accepted" | "overridden" | "saving";
};

function pct(v: number | null | undefined, digits = 0): string {
  if (v == null || isNaN(v)) return "—";
  return `${(v * 100).toFixed(digits)}%`;
}
function pts(v: number | null | undefined): string {
  if (v == null || isNaN(v)) return "—";
  return `${v >= 0 ? "+" : ""}${(v * 100).toFixed(0)} pts`;
}
function eur(v: number | null | undefined): string {
  if (v == null || isNaN(v)) return "—";
  return `€${Math.round(v).toLocaleString()}`;
}
function decisionBadge(d?: string | null) {
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

export default function CockpitHero({
  summary,
  best,
  onExplain,
  onAccept,
  onOverride,
  actionState = "idle",
}: Props) {
  const oee = pct(summary.best_predicted_oee);
  const benchmark = summary.line_transition_benchmark_oee;
  const benchmarkDelta =
    benchmark != null
      ? (summary.best_predicted_oee - benchmark) * 100
      : null;
  const gainPts = Math.round(summary.estimated_oee_gain * 100);
  const cleaning = best.cleaning_impact;
  const cleaningRisk = cleaning?.cleaning_risk ?? "unknown";
  const cleaningRiskClass =
    cleaningRisk === "low"
      ? "chip-ok"
      : cleaningRisk === "medium"
      ? "chip-warn"
      : cleaningRisk === "high"
      ? "chip-bad"
      : "chip-blue";

  return (
    <motion.div
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4 }}
      className="space-y-4"
    >
      {/* Hero card */}
      <div className="card p-6 md:p-7 border border-damm-accent/30 shadow-glow">
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div className="space-y-1">
            <div className="flex items-center gap-2">
              <span className="text-xs uppercase tracking-[0.2em] text-damm-accent">
                LineWise recommends
              </span>
              {decisionBadge(summary.decision)}
            </div>
            <div className="text-3xl md:text-4xl font-semibold text-white">
              Line {summary.best_line}{" "}
              <span className="text-damm-accent">{summary.best_position}</span>
            </div>
            <div className="text-sm text-damm-muted">
              Decision protects {summary.hl_protected?.toFixed(0) ?? "—"} HL ·
              ~{summary.capacity_hours_saved?.toFixed(1) ?? "—"} capacity hours ·
              est. value {eur(summary.financial_delta_eur)}
            </div>
          </div>
          <div className="flex gap-2 flex-wrap">
            <button onClick={onExplain} className="btn btn-ghost">
              Why this?
            </button>
            {onAccept ? (
              <button
                onClick={onAccept}
                disabled={actionState === "accepted" || actionState === "saving"}
                className="btn btn-primary disabled:opacity-60"
              >
                {actionState === "accepted" ? "Accepted ✓" : "Accept plan"}
              </button>
            ) : null}
            {onOverride ? (
              <button
                onClick={onOverride}
                disabled={actionState === "overridden" || actionState === "saving"}
                className="btn btn-ghost disabled:opacity-60"
              >
                {actionState === "overridden" ? "Overridden" : "Override"}
              </button>
            ) : null}
          </div>
        </div>
      </div>

      {/* Four-up business cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <CockpitCard
          label="Value at Stake"
          value={eur(summary.financial_delta_eur)}
          sub="vs. naive plan"
          tone={(summary.financial_delta_eur ?? 0) > 0 ? "good" : "default"}
        />
        <CockpitCard
          label="Capacity Protected"
          value={`${summary.capacity_hours_saved?.toFixed(1) ?? "—"} h`}
          sub={`${summary.hl_protected?.toFixed(0) ?? "—"} HL protected`}
          tone="accent"
        />
        <CockpitCard
          label="OEE vs Benchmark"
          value={oee}
          sub={
            benchmark != null
              ? `Hist. benchmark ${pct(benchmark)} · ${benchmarkDelta != null ? `${benchmarkDelta >= 0 ? "+" : ""}${benchmarkDelta.toFixed(0)} pts` : ""}`
              : "Naive: " + pct(summary.naive_predicted_oee)
          }
          tone={
            benchmarkDelta != null
              ? benchmarkDelta >= 0
                ? "good"
                : benchmarkDelta <= -3
                ? "bad"
                : "warn"
              : "default"
          }
        />
        <CockpitCard
          label="Cleaning / Changeover"
          value={
            cleaning?.cf_theoretical_minutes != null && cleaning?.historical_actual_changeover_minutes != null
              ? `${Math.round(cleaning.historical_actual_changeover_minutes)} / ${Math.round(cleaning.cf_theoretical_minutes)} min`
              : "—"
          }
          sub={
            cleaning?.execution_gap_minutes != null
              ? `gap ${cleaning.execution_gap_minutes >= 0 ? "+" : ""}${cleaning.execution_gap_minutes.toFixed(0)} min · risk ${cleaningRisk}`
              : "Risk " + cleaningRisk
          }
          tone={
            cleaningRisk === "low"
              ? "good"
              : cleaningRisk === "high"
              ? "bad"
              : "warn"
          }
        />
      </div>

      {/* Side-by-side: Recommendation summary + Historical benchmark */}
      <div className="grid lg:grid-cols-2 gap-4">
        <div className="card p-5">
          <div className="text-xs uppercase tracking-wider text-damm-muted mb-2">
            Recommendation
          </div>
          <div className="space-y-2 text-sm">
            <Row label="Decision" value={summary.decision ?? "—"} />
            <Row label="Line + Slot" value={`Line ${summary.best_line} ${summary.best_position}`} />
            <Row label="Predicted OEE" value={pct(summary.best_predicted_oee)} />
            <Row label="OEE vs Naive" value={`${gainPts >= 0 ? "+" : ""}${gainPts} pts`} />
            <Row label="HL Protected" value={`${summary.hl_protected?.toFixed(0) ?? "—"} HL`} />
            <Row label="Est. value vs naive" value={eur(summary.financial_delta_eur)} />
            <Row label="Capacity hours saved" value={`${summary.capacity_hours_saved?.toFixed(1) ?? "—"} h`} />
          </div>
        </div>
        <div className="card p-5">
          <div className="text-xs uppercase tracking-wider text-damm-muted mb-2">
            Historical benchmark
          </div>
          <div className="space-y-2 text-sm">
            <Row label="Transition type" value={best.transition_type ?? "—"} />
            <Row label="Line + transition OEE" value={pct(best.historical_benchmark?.line_transition_benchmark_oee)} />
            <Row label="Line OEE (all)" value={pct(best.historical_benchmark?.line_format_benchmark_oee)} />
            <Row label="Naive-slot OEE" value={pct(summary.naive_predicted_oee)} />
            <Row label="Analogue cases" value={String(best.historical_benchmark?.cases_used ?? best.similar_cases_count)} />
            <Row
              label="Months used"
              value={
                best.historical_benchmark?.months_used?.length
                  ? best.historical_benchmark.months_used.slice(-6).join(", ")
                  : "—"
              }
            />
            <Row label="Evidence strength" value={best.evidence_strength_label} />
          </div>
        </div>
      </div>
    </motion.div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between gap-3 text-damm-ink">
      <span className="text-damm-muted">{label}</span>
      <span className="font-mono text-white">{value}</span>
    </div>
  );
}

function CockpitCard({
  label,
  value,
  sub,
  tone = "default",
}: {
  label: string;
  value: string;
  sub?: string;
  tone?: "default" | "good" | "warn" | "bad" | "accent";
}) {
  const toneClass = {
    default: "border-white/5",
    good: "border-damm-ok/40 shadow-[0_0_0_1px_rgba(40,199,111,0.3)]",
    warn: "border-damm-warn/40 shadow-[0_0_0_1px_rgba(246,185,59,0.3)]",
    bad: "border-damm-bad/40 shadow-[0_0_0_1px_rgba(255,92,92,0.3)]",
    accent: "border-damm-accent/40 shadow-glow",
  }[tone];
  return (
    <div className={clsx("card p-4 border", toneClass)}>
      <div className="text-[10px] uppercase tracking-wider text-damm-muted">
        {label}
      </div>
      <div className="text-2xl font-semibold text-white mt-1">{value}</div>
      {sub ? <div className="text-xs text-damm-muted mt-1">{sub}</div> : null}
    </div>
  );
}
