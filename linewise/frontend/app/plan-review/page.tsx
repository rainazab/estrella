"use client";
import { useEffect, useState } from "react";
import { motion } from "framer-motion";
import clsx from "clsx";
import MetricCard from "../../components/MetricCard";
import { postPlanReview } from "../../lib/api";
import type {
  PlanReviewResponse,
  PlanReviewSwap,
  PlanReviewTransition,
} from "../../lib/types";

function pct(v: number | null | undefined, d = 0): string {
  if (v == null || isNaN(v)) return "—";
  return `${(v * 100).toFixed(d)}%`;
}
function eur(v: number | null | undefined): string {
  if (v == null || isNaN(v)) return "—";
  return `€${Math.round(v).toLocaleString()}`;
}
function fmin(v: number | null | undefined): string {
  if (v == null || isNaN(v)) return "—";
  return `${Math.round(v)} min`;
}

export default function PlanReviewPage() {
  const [data, setData] = useState<PlanReviewResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    postPlanReview()
      .then(setData)
      .catch((e) => setErr(String(e)))
      .finally(() => setLoading(false));
  }, []);

  return (
    <main className="space-y-6">
      <div>
        <div className="text-xs uppercase tracking-[0.2em] text-damm-muted">
          Plan Review
        </div>
        <h1 className="text-3xl md:text-4xl font-semibold text-white mt-1">
          Where are we about to lose OEE and money?
        </h1>
        <p className="mt-2 text-damm-muted max-w-2xl">
          Stride walks every transition in the loaded plan, compares it against
          the CF baseline and the diagnostic memory, and flags the slots that
          historically slip — with HL and € numbers attached.
        </p>
      </div>

      {loading ? <div className="text-sm text-damm-muted">Scoring the plan…</div> : null}
      {err ? <div className="card p-4 border border-damm-bad/40 text-damm-bad">{err}</div> : null}

      {data ? (
        <>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <MetricCard
              label="Plan Health"
              value={`${data.plan_health_score.toFixed(0)}/100`}
              sub={`${data.transitions_evaluated} transitions evaluated`}
              tone={
                data.plan_health_score >= 75
                  ? "good"
                  : data.plan_health_score >= 50
                  ? "warn"
                  : "bad"
              }
            />
            <MetricCard
              label="Value at Risk"
              value={eur(data.estimated_value_at_risk_eur)}
              sub="Estimated, vs. CF baseline"
              tone={data.estimated_value_at_risk_eur > 0 ? "warn" : "default"}
            />
            <MetricCard
              label="Capacity at Risk"
              value={`${data.capacity_hours_at_risk.toFixed(1)} h`}
              sub="Sum of execution gaps"
              tone="warn"
            />
            <MetricCard
              label="Expected OEE Leakage"
              value={`${data.expected_oee_leakage_points.toFixed(1)} pts`}
              sub="Versus historical benchmark"
              tone={data.expected_oee_leakage_points < -10 ? "bad" : "warn"}
            />
          </div>

          {data.recommended_swaps.length > 0 ? (
            <SwapsPanel swaps={data.recommended_swaps} />
          ) : null}

          {data.infeasible_transitions.length > 0 ? (
            <InfeasiblePanel rows={data.infeasible_transitions} />
          ) : null}

          {data.risky_transitions.length > 0 ? (
            <TransitionsPanel
              title="Risky transitions"
              subtitle="Where execution typically slips beyond the CF baseline or diagnostic memory flags risk."
              rows={data.risky_transitions}
              tone="warn"
            />
          ) : null}

          {data.cleaning_heavy_transitions.length > 0 ? (
            <TransitionsPanel
              title="Cleaning-heavy sequences"
              subtitle="Long CF gaps or format-volume transitions worth resequencing."
              rows={data.cleaning_heavy_transitions}
              tone="default"
            />
          ) : null}

          <div className="text-xs text-damm-muted">
            Financial assumptions:{" "}
            €{data.assumptions.value_per_hl_eur}/HL ·{" "}
            €{data.assumptions.downtime_cost_per_hour_eur}/h downtime ·{" "}
            €{data.assumptions.overtime_recovery_cost_per_hour_eur}/h overtime.
          </div>
        </>
      ) : null}
    </main>
  );
}

function SwapsPanel({ swaps }: { swaps: PlanReviewSwap[] }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 4 }}
      animate={{ opacity: 1, y: 0 }}
      className="card p-5 border border-damm-accent/30"
    >
      <div className="text-xs uppercase tracking-[0.2em] text-damm-accent mb-3">
        Recommended swaps
      </div>
      <ul className="space-y-3">
        {swaps.map((s, i) => (
          <li
            key={i}
            className="flex items-start gap-3 rounded-xl border border-damm-accent/20 bg-damm-accent/[0.04] px-3 py-2"
          >
            <span className="chip chip-bad">L{s.from_line}</span>
            <span className="text-damm-muted">→</span>
            <span className="chip chip-ok">L{s.to_line}</span>
            <div className="text-sm text-damm-ink/90 flex-1">
              <div className="font-medium text-white">{s.transition_type}</div>
              <div className="text-xs text-damm-muted font-mono">
                {s.previous_of} → {s.current_of}
              </div>
              <div className="mt-1">{s.rationale}</div>
            </div>
          </li>
        ))}
      </ul>
    </motion.div>
  );
}

function TransitionsPanel({
  title,
  subtitle,
  rows,
  tone,
}: {
  title: string;
  subtitle: string;
  rows: PlanReviewTransition[];
  tone: "warn" | "default";
}) {
  return (
    <div className={clsx("card overflow-hidden", tone === "warn" && "border border-damm-warn/20")}>
      <div className="px-5 py-3 border-b border-white/5">
        <div className="text-sm font-semibold text-white">{title}</div>
        <div className="text-xs text-damm-muted">{subtitle}</div>
      </div>
      <div className="overflow-x-auto scrollbar-thin">
        <table className="w-full text-sm">
          <thead className="text-left text-damm-muted text-xs uppercase tracking-wider">
            <tr>
              <th className="px-5 py-3">Line</th>
              <th className="px-3 py-3">Prev OF → Cur OF</th>
              <th className="px-3 py-3">Transition</th>
              <th className="px-3 py-3 text-right">CF</th>
              <th className="px-3 py-3 text-right">Actual</th>
              <th className="px-3 py-3 text-right">Gap</th>
              <th className="px-3 py-3 text-right">Bench OEE</th>
              <th className="px-3 py-3">Risk</th>
              <th className="px-5 py-3 text-right">€ at risk</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={i} className="border-t border-white/5">
                <td className="px-5 py-3 font-semibold text-white">{r.line}</td>
                <td className="px-3 py-3 font-mono text-xs text-damm-ink">
                  {r.previous_of} → {r.current_of}
                </td>
                <td className="px-3 py-3">
                  <div>{r.transition_type}</div>
                  {r.diagnostic_risk_pattern ? (
                    <div className="text-[10px] text-damm-muted">{r.diagnostic_risk_pattern}</div>
                  ) : null}
                </td>
                <td className="px-3 py-3 text-right font-mono text-damm-muted">
                  {fmin(r.cf_theoretical_minutes)}
                </td>
                <td className="px-3 py-3 text-right font-mono text-white">
                  {fmin(r.historical_actual_changeover_minutes)}
                </td>
                <td
                  className={clsx(
                    "px-3 py-3 text-right font-mono",
                    (r.execution_gap_minutes ?? 0) > 60 ? "text-damm-bad" : "text-damm-warn",
                  )}
                >
                  {r.execution_gap_minutes != null
                    ? `${r.execution_gap_minutes >= 0 ? "+" : ""}${Math.round(r.execution_gap_minutes)} min`
                    : "—"}
                </td>
                <td className="px-3 py-3 text-right font-mono text-damm-muted">
                  {pct(r.line_transition_benchmark_oee)}
                </td>
                <td className="px-3 py-3">
                  <span
                    className={clsx(
                      "chip",
                      r.diagnostic_risk_level === "high" && "chip-bad",
                      r.diagnostic_risk_level === "medium" && "chip-warn",
                      r.diagnostic_risk_level === "low" && "chip-ok",
                      !r.diagnostic_risk_level && "chip-blue",
                    )}
                  >
                    {r.diagnostic_risk_level ?? "—"}
                  </span>
                </td>
                <td className="px-5 py-3 text-right font-mono text-damm-warn">
                  {eur(r.estimated_value_at_risk_eur)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function InfeasiblePanel({ rows }: { rows: PlanReviewTransition[] }) {
  return (
    <div className="card p-5 border border-damm-bad/30">
      <div className="text-xs uppercase tracking-[0.2em] text-damm-bad mb-2">
        Infeasible transitions in the plan
      </div>
      <ul className="space-y-2">
        {rows.map((r, i) => (
          <li
            key={i}
            className="flex items-start gap-3 rounded-xl border border-damm-bad/30 bg-damm-bad/5 px-3 py-2"
          >
            <span className="chip chip-bad">Line {r.line}</span>
            <span className="text-sm text-damm-ink/90 flex-1">
              {r.infeasibility_reason ?? "Line cannot run this format."}
              <span className="text-xs text-damm-muted ml-2 font-mono">
                {r.previous_of} → {r.current_of}
              </span>
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
