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

/* PlanReviewInsertion — paired insert + shifted-run group, one per
   urgent insertion the planner accepted. Sourced from
   /plan.recommendations[line].plan (kind: "ins" | "shift" segments)
   merged with .moves[] (shift hours + reason) and .lineBaseline.

   Backend contract spec lives in API_CONTRACT.md §PlanReview. Adding
   the type inline here until lib/types is materialised — keep this
   block authoritative; the lib/types extraction must mirror it. */
export type PlanReviewInsertion = {
  line: string;                 // "14"
  line_avg_oee: number;         // 30-day rolling baseline, 0..1
  inserted: PlanReviewRun;
  shifted: PlanReviewShiftedRun[];
};
export type PlanReviewRun = {
  of: string;                   // order code, e.g. "ED13LTNN"
  sku_code: string;             // material code shown big in the card
  sku_name: string | null;      // long description
  format: string;               // "33cl"
  units: number;                // unit count
  duration_minutes: number;
  oee: number;                  // 0..1
  oee_delta_vs_line_avg: number;
};
export type PlanReviewShiftedRun = PlanReviewRun & {
  shift_hours: number;          // positive = pushed later
  reason: string;               // "pushed back to make room for ED13LTNN"
};

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

          {data.insertion_moves && data.insertion_moves.length > 0 ? (
            <InsertionShiftPanel insertions={data.insertion_moves} />
          ) : null}

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

function InsertionShiftPanel({
  insertions,
}: {
  insertions: PlanReviewInsertion[];
}) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 4 }}
      animate={{ opacity: 1, y: 0 }}
      className="card p-5"
    >
      <div className="text-xs uppercase tracking-[0.2em] text-damm-muted mb-3">
        Insertion &amp; shifted <span className="text-damm-accent">(rec mode)</span>
      </div>
      <div className="space-y-5">
        {insertions.map((m, i) => (
          <InsertionShiftRow key={i} move={m} />
        ))}
      </div>
    </motion.div>
  );
}

function InsertionShiftRow({ move }: { move: PlanReviewInsertion }) {
  return (
    <div className="flex flex-wrap gap-3 items-stretch">
      <InsertCard
        sku={move.inserted.sku_code}
        skuLong={move.inserted.sku_name}
        format={move.inserted.format}
        units={move.inserted.units}
        durationMinutes={move.inserted.duration_minutes}
        oee={move.inserted.oee}
        oeeDelta={move.inserted.oee_delta_vs_line_avg}
        lineAvg={move.line_avg_oee}
      />
      {move.shifted.map((s, i) => (
        <ShiftCard
          key={i}
          sku={s.sku_code}
          skuLong={s.sku_name}
          format={s.format}
          units={s.units}
          durationMinutes={s.duration_minutes}
          oee={s.oee}
          oeeDelta={s.oee_delta_vs_line_avg}
          shiftHours={s.shift_hours}
          lineAvg={move.line_avg_oee}
        />
      ))}
    </div>
  );
}

function InsertCard(props: {
  sku: string;
  skuLong?: string | null;
  format: string;
  units: number;
  durationMinutes: number;
  oee: number;
  oeeDelta: number;
  lineAvg: number;
}) {
  return (
    <CardFrame variant="ins" headerLabel="Urgent insert" headerDot>
      <CardBody {...props} />
    </CardFrame>
  );
}

function ShiftCard(props: {
  sku: string;
  skuLong?: string | null;
  format: string;
  units: number;
  durationMinutes: number;
  oee: number;
  oeeDelta: number;
  shiftHours: number;
  lineAvg: number;
}) {
  return (
    <CardFrame
      variant="shift"
      headerLabel={`Shifted +${props.shiftHours}h to make room`}
    >
      <CardBody {...props} />
    </CardFrame>
  );
}

function CardFrame({
  variant,
  headerLabel,
  headerDot = false,
  children,
}: {
  variant: "ins" | "shift";
  headerLabel: string;
  headerDot?: boolean;
  children: React.ReactNode;
}) {
  const headerCls =
    variant === "ins"
      ? "bg-damm-accent/90 text-white"
      : "bg-white/10 text-damm-ink/90";
  const frameCls =
    variant === "ins"
      ? "border-damm-accent/60 bg-damm-accent/[0.06]"
      : "border-white/10 bg-white/[0.03]";
  return (
    <div
      className={clsx(
        "w-[260px] rounded-2xl overflow-hidden border flex flex-col",
        frameCls,
      )}
    >
      <div
        className={clsx(
          "px-3 py-2 text-[11px] uppercase tracking-[0.18em] font-semibold flex items-center gap-2",
          headerCls,
        )}
      >
        {headerDot && (
          <span className="w-2 h-2 rounded-full bg-white" aria-hidden="true" />
        )}
        {headerLabel}
      </div>
      {children}
    </div>
  );
}

function CardBody({
  sku,
  skuLong,
  format,
  units,
  durationMinutes,
  oee,
  oeeDelta,
  lineAvg,
}: {
  sku: string;
  skuLong?: string | null;
  format: string;
  units: number;
  durationMinutes: number;
  oee: number;
  oeeDelta: number;
  lineAvg: number;
}) {
  return (
    <div className="px-4 py-3 flex flex-col gap-2">
      <div className="flex items-center justify-between gap-2">
        <span className="font-mono text-white font-semibold tracking-wide">
          {sku}
        </span>
        <span className="text-[11px] px-2 py-0.5 rounded-md bg-white/10 text-damm-ink/80 font-mono">
          {format}
        </span>
      </div>
      {skuLong ? (
        <div className="text-xs text-damm-muted truncate" title={skuLong}>
          {skuLong}
        </div>
      ) : null}
      <div className="h-px bg-white/10 my-1" />
      <div className="flex items-baseline justify-between text-sm">
        <span>
          <span className="font-semibold text-white">{fmtUnits(units)}</span>
          <span className="text-damm-muted"> un</span>
          <span className="text-damm-muted"> · {fmtDur(durationMinutes)}</span>
        </span>
        <span className="font-mono">
          <span className="text-[10px] text-damm-muted mr-1">OEE</span>
          <span className="text-white font-semibold">{oee.toFixed(2)}</span>
        </span>
      </div>
      <div
        className={clsx(
          "text-[11px] flex items-center gap-1",
          oeeDelta > 0.005
            ? "text-damm-good"
            : oeeDelta < -0.005
              ? "text-damm-bad"
              : "text-damm-muted",
        )}
      >
        <span>± {Math.abs(oeeDelta).toFixed(2)}</span>
        <span className="text-damm-muted">
          at line avg {lineAvg.toFixed(2)}
        </span>
      </div>
    </div>
  );
}

function fmtUnits(n: number): string {
  if (n >= 1000) return `${(n / 1000).toFixed(n >= 10000 ? 0 : 1)}k`;
  return String(n);
}

function fmtDur(min: number): string {
  if (min < 60) return `${min}m`;
  const h = Math.floor(min / 60);
  const m = Math.round(min - h * 60);
  return m === 0 ? `${h}h` : `${h}h ${m}m`;
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
